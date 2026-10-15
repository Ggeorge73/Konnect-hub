import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from '../data/memory';
import { sessionFor } from '../session';
import { outbox, clearOutbox } from '../email/send';
import {
  answerSurvey,
  decideItem,
  getProjectCommercial,
  listEvents,
  listItems,
  openCount,
  openItem,
  receive,
  retryEvent,
  runDueDeliveries,
  sendReminders,
  syncHealth,
} from './service';
import { mockCrm, samples } from './mock-crm';
import { sign } from './signing';
import { DEV_INTEGRATION_SECRET } from './transport';
import { SEED_QUOTE_ID, SEED_SURVEY_ID } from '../data/seed-crm';

const as = (id: string) => sessionFor(id);
const send = (payload: object, t = Date.now()) => {
  const { body, signature } = mockCrm.signed(payload as never, t);
  return receive(body, signature);
};
const fresh = new Date().toISOString();
const accept = { decision: 'accepted' as const, name: 'Grace Whitfield', title: 'COO' };

beforeEach(() => {
  resetDb();
  mockCrm.reset();
  clearOutbox();
});

describe('inbound security', () => {
  it('rejects unsigned, tampered and stale calls', async () => {
    const body = JSON.stringify(samples.handoff());
    expect((await receive(body, null)).status).toBe(401);
    expect((await receive(body + ' ', sign(body, DEV_INTEGRATION_SECRET))).body.error).toBe('bad signature');
    const old = Date.now() - 10 * 60_000;
    expect((await receive(body, sign(body, DEV_INTEGRATION_SECRET, old))).body.error).toBe('stale signature');
    expect((await receive(body, sign(body, 'some-other-secret'))).status).toBe(401);
  });

  it('rejects any payload with fields outside the contract, and does not store its content', async () => {
    const p = samples.publish('org_peachtree', 'p_ehr') as { item: Record<string, unknown> };
    (p.item.lines as Record<string, unknown>[])[0].unit_cost = 120;
    const r = await send(p);
    expect(r.status).toBe(422);
    expect(String(r.body.error)).toMatch(/outside the contract.*unit_cost/);
    const extra = samples.handoff() as Record<string, unknown>;
    extra.internal_notes_x = 'x';
    expect((await send(extra)).status).toBe(422);
    const events = await listEvents(as('u_admin'));
    expect(events.filter((e) => e.status === 'rejected')).toHaveLength(2);
    expect(
      events.every(
        (e) => JSON.stringify(e.payload) === '{}' || !JSON.stringify(e).includes('unit_cost":120'),
      ),
    );
    expect(db().crm.items.some((i) => i.title.includes('CR-12'))).toBe(false);
  });

  it('only Admins read the event log', async () => {
    await expect(listEvents(as('u_lead'))).rejects.toThrow(/Admins/);
  });
});

describe('opportunity.won handoff', () => {
  it('creates the client, the project from the hybrid template, the link and the portal invites', async () => {
    const payload = samples.handoff();
    const r = await send(payload);
    expect(r.status).toBe(200);
    const {
      konnect_hub_client_id: orgId,
      konnect_hub_project_id: projectId,
      project_url,
    } = r.body as Record<string, string>;
    const org = db().orgs.find((o) => o.id === orgId)!;
    expect(org).toMatchObject({ name: 'Harbor Health Partners', type: 'client' });
    const project = db().projects.find((p) => p.id === projectId)!;
    expect(project).toMatchObject({
      key: 'HPPR',
      clientOrgId: orgId,
      leadId: 'u_lead',
      bac: 250000,
      startDate: '2026-11-02',
      targetDate: '2027-05-28',
      templateId: 'kdf-hybrid',
    });
    expect(project.description).toContain('Contract HHP-2026-007');
    expect(db().phases.filter((ph) => ph.projectId === projectId)).toHaveLength(5);
    expect(project_url).toMatch(/\/projects\/HPPR$/);
    const invites = db().workspace.invites.filter((i) => i.orgId === orgId);
    expect(invites.map((i) => [i.email, i.role])).toEqual([
      ['dana.reyes@harborhealth.example', 'client_sponsor'],
      ['sam.ortiz@harborhealth.example', 'client_member'],
    ]);
    const c = await getProjectCommercial(as('u_lead'), 'HPPR');
    expect(c.link).toMatchObject({
      contractNo: 'HHP-2026-007',
      value: 250000,
      acceptanceCriteria: payload.event === 'opportunity.won' ? payload.project.acceptance_criteria : [],
    });
    expect(c.link!.documents[0].name).toBe('Signed SOW.pdf');
  });

  it('is idempotent and matches the client by CRM account on the next deal', async () => {
    const payload = samples.handoff();
    const a = await send(payload);
    const b = await send(payload);
    expect(b.body).toMatchObject({ ...a.body, idempotent_replay: true });
    expect(db().projects.filter((p) => p.name === 'Harbor Patient Portal Rollout')).toHaveLength(1);
    const next = await send(samples.handoff({ name: 'Harbor Phase Two' }));
    expect(next.body.konnect_hub_client_id).toBe(a.body.konnect_hub_client_id);
    expect(db().orgs.filter((o) => o.name === 'Harbor Health Partners')).toHaveLength(1);
  });

  it('refuses an unknown delivery lead (the CRM fixes and resends)', async () => {
    const r = await send(samples.handoff({ leadEmail: 'nobody@konnectortech.com' }));
    expect(r.status).toBe(422);
    const [e] = await listEvents(as('u_admin'));
    expect(e).toMatchObject({ status: 'failed', event: 'opportunity.won' });
  });

  it('project.extended moves the end date and adds value, with a change entry', async () => {
    const r = await send(samples.handoff());
    const id = r.body.konnect_hub_project_id as string;
    expect((await send(samples.extend(id, '2027-08-31', 40000))).status).toBe(200);
    const p = db().projects.find((x) => x.id === id)!;
    expect(p).toMatchObject({ targetDate: '2027-08-31', bac: 290000 });
    const link = (await getProjectCommercial(as('u_admin'), p.key)).link!;
    expect(link.value).toBe(290000);
    expect(link.changes[0]).toMatchObject({
      previousEndDate: '2027-05-28',
      newEndDate: '2027-08-31',
      additionalValue: 40000,
    });
    expect(db().activity.some((a) => a.projectId === id && a.action === 'project.extended')).toBe(true);
  });
});

describe('commercial items in the portal', () => {
  it('a published item appears "for your review" for the client only, and notifies approvers', async () => {
    const p = samples.publish('org_peachtree', 'p_ehr');
    expect((await send(p)).status).toBe(200);
    const sponsor = as('u_sponsor');
    const mine = await listItems(sponsor);
    expect(mine.map((i) => i.title)).toContain('Change request CR-12: lab interface');
    expect(await openCount(sponsor)).toBe(3); // with the seeded quote and survey
    expect((await listItems(as('u_rsponsor'))).map((i) => i.orgId)).toEqual(['org_riverbend']);
    expect(db().notifications.some((n) => n.userId === 'u_sponsor' && n.kind === 'commercial_review')).toBe(
      true,
    );
    // Konnector users see it read-only on the project; associates do not.
    expect((await getProjectCommercial(as('u_team'), 'EHR')).items.length).toBe(3);
    expect((await getProjectCommercial(as('u_team'), 'EHR')).link).toBeNull();
    await expect(getProjectCommercial(as('u_assoc'), 'EHR')).rejects.toThrow();
  });

  it('first open sends client_item.viewed once', async () => {
    await openItem(as('u_sponsor'), SEED_QUOTE_ID);
    await openItem(as('u_cmember'), SEED_QUOTE_ID);
    await openItem(as('u_lead'), SEED_QUOTE_ID);
    const viewed = mockCrm.received().filter((r) => r.event === 'client_item.viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0].payload).toMatchObject({
      item_id: SEED_QUOTE_ID,
      version: 1,
      viewed_by: { email: as('u_sponsor').user.email },
    });
  });

  it('accept needs a fresh re-auth, name and title; records email, time and IP; tells the CRM and the Lead', async () => {
    const sponsor = as('u_sponsor');
    await expect(
      decideItem(sponsor, SEED_QUOTE_ID, accept, { ip: '203.0.113.9', reauthAt: null }),
    ).rejects.toThrow();
    const item = await decideItem(sponsor, SEED_QUOTE_ID, accept, { ip: '203.0.113.9', reauthAt: fresh });
    expect(item).toMatchObject({
      status: 'accepted',
      decidedByName: 'Grace Whitfield',
      decidedByTitle: 'COO',
      decidedByEmail: sponsor.user.email,
      decidedIp: '203.0.113.9',
    });
    const [decided] = mockCrm.received().filter((r) => r.event === 'client_item.decided');
    expect(decided.payload).toMatchObject({
      decision: 'accepted',
      decided_by: { name: 'Grace Whitfield', title: 'COO' },
      ip: '203.0.113.9',
    });
    expect(db().notifications.some((n) => n.userId === 'u_lead' && n.kind === 'commercial_decided')).toBe(
      true,
    );
    expect(db().audit.some((a) => a.action === 'client_item.accepted')).toBe(true);
    await expect(decideItem(sponsor, SEED_QUOTE_ID, accept, { ip: null, reauthAt: fresh })).rejects.toThrow(
      /already been decided/,
    );
  });

  it('request changes needs a note; members, viewers and Konnector users cannot decide', async () => {
    await expect(
      decideItem(as('u_cmember'), SEED_QUOTE_ID, { decision: 'declined' }, { ip: null, reauthAt: fresh }),
    ).rejects.toThrow(/approvers/);
    await expect(
      decideItem(as('u_cviewer'), SEED_QUOTE_ID, { decision: 'declined' }, { ip: null, reauthAt: fresh }),
    ).rejects.toThrow();
    await expect(
      decideItem(as('u_lead'), SEED_QUOTE_ID, { decision: 'declined' }, { ip: null, reauthAt: fresh }),
    ).rejects.toThrow(/owned by the CRM/);
    await expect(
      decideItem(as('u_rsponsor'), SEED_QUOTE_ID, { decision: 'declined' }, { ip: null, reauthAt: fresh }),
    ).rejects.toThrow(/not found/);
    const item = await decideItem(
      as('u_sponsor'),
      SEED_QUOTE_ID,
      { decision: 'changes_requested', note: 'Two weeks, not four.' },
      { ip: null, reauthAt: null },
    );
    expect(item).toMatchObject({ status: 'changes_requested', decisionNote: 'Two weeks, not four.' });
  });

  it('a signature item cannot be click-accepted', async () => {
    const p = samples.publish('org_peachtree', 'p_ehr', { id: 'ci_sig', requiresSignature: true });
    await send(p);
    await expect(
      decideItem(as('u_sponsor'), 'ci_sig', accept, { ip: null, reauthAt: fresh }),
    ).rejects.toThrow(/signing/);
  });

  it('a new version supersedes the old one; withdrawn items stay readable with their reason', async () => {
    await send(samples.publish('org_peachtree', 'p_ehr', { id: 'ci_v1', lineage: 'lin_x', version: 1 }));
    await send(samples.publish('org_peachtree', 'p_ehr', { id: 'ci_v2', lineage: 'lin_x', version: 2 }));
    const sponsor = as('u_sponsor');
    const ids = (await listItems(sponsor)).map((i) => i.id);
    expect(ids).toContain('ci_v2');
    expect(ids).not.toContain('ci_v1');
    expect((await openItem(sponsor, 'ci_v1')).status).toBe('superseded');
    expect((await send(samples.withdraw('ci_v2', 2))).status).toBe(200);
    const w = await openItem(sponsor, 'ci_v2');
    expect(w).toMatchObject({ status: 'withdrawn', withdrawnReason: 'Superseded by a revised offer.' });
    await expect(decideItem(sponsor, 'ci_v2', accept, { ip: null, reauthAt: fresh })).rejects.toThrow(
      /withdrawn/,
    );
  });

  it('surveys take a 0–10 score from sponsors and members', async () => {
    const item = await answerSurvey(as('u_cmember'), SEED_SURVEY_ID, { score: 9, comment: 'Great kickoff' });
    expect(item).toMatchObject({ surveyScore: 9, surveyComment: 'Great kickoff' });
    const [s] = mockCrm.received().filter((r) => r.event === 'survey.submitted');
    expect(s.payload).toMatchObject({ score: 9, comment: 'Great kickoff', item_id: SEED_SURVEY_ID });
    await expect(answerSurvey(as('u_cviewer'), SEED_SURVEY_ID, { score: 3 })).rejects.toThrow();
  });

  it('reminds approvers 3 days before respond-by, once', async () => {
    const at = new Date('2026-11-18T12:00:00Z');
    expect((await sendReminders(new Date('2026-11-01T12:00:00Z'))).reminded).toBe(0);
    expect((await sendReminders(at)).reminded).toBe(1);
    expect((await sendReminders(at)).reminded).toBe(0);
    expect(outbox().some((m) => m.subject.startsWith('Reminder: quote'))).toBe(true);
  });
});

describe('outbound delivery and health', () => {
  it('retries failed deliveries with backoff and lets an Admin retry by hand', async () => {
    mockCrm.failNext(2);
    await openItem(as('u_sponsor'), SEED_QUOTE_ID);
    let [e] = (await listEvents(as('u_admin'))).filter((x) => x.direction === 'outbound');
    expect(e).toMatchObject({ status: 'failed', attempts: 1 });
    expect(Date.parse(e.nextAttemptAt!) - Date.now()).toBeGreaterThan(50_000);
    expect((await runDueDeliveries(new Date())).due).toBe(0); // not due yet
    e = await retryEvent(as('u_admin'), e.id);
    expect(e).toMatchObject({ status: 'failed', attempts: 2 });
    expect((await runDueDeliveries(new Date(Date.now() + 10 * 60_000))).delivered).toBe(1);
    await expect(retryEvent(as('u_lead'), e.id)).rejects.toThrow();
  });

  it('sends project health for handed-off projects on change and at least daily', async () => {
    const now = new Date('2026-10-15T10:00:00Z');
    expect((await syncHealth(now)).sent).toBe(2); // EHR and RVB are linked in the seed
    const h = mockCrm
      .received()
      .find((r) => r.event === 'project.health_updated' && r.payload.konnect_hub_project_id === 'p_ehr')!;
    expect(h.payload).toMatchObject({
      event: 'project.health_updated',
      konnect_hub_project_id: 'p_ehr',
      status: 'active',
    });
    expect(['green', 'amber', 'red']).toContain(h.payload.health_schedule);
    expect((await syncHealth(new Date('2026-10-15T11:00:00Z'))).sent).toBe(0);
    expect((await syncHealth(new Date('2026-10-16T10:30:00Z'))).sent).toBe(2);
  });
});
