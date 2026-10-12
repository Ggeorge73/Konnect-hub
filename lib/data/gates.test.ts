import { beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { db, resetDb } from './memory';
import { redactReview } from '../domain/gates';
import { sessionFor } from '../session';
import {
  addCriterion,
  decideGate,
  getGates,
  listPendingReviews,
  removeCriterion,
  requestReview,
  updateCriterion,
} from './gates';
import {
  decideCriterion,
  listAwaitingAcceptance,
  listDeliverables,
  createDeliverable,
  submitDeliverable,
} from './deliverables';
import { buildAcceptanceRecord } from './acceptance-record';
import { renderAcceptanceRecord, toWinAnsi } from '../pdf/acceptance-record';
import { signReauth, verifyReauth } from '../reauth';

const as = (id: string) => sessionFor(id);
const fresh = () => ({ reauthAt: new Date().toISOString(), ip: '203.0.113.50' });
const tickAll = async (phaseId: string) => {
  for (const c of db().criteria.filter((x) => x.phaseId === phaseId))
    await updateCriterion(as('u_lead'), 'EHR', c.id, { done: true });
};

describe('gates data layer', () => {
  beforeEach(() => resetDb());

  it('seeds approved reviews for EHR gates 1 and 2 by Grace Whitfield', async () => {
    const g = await getGates(as('u_lead'), 'EHR');
    expect(g.reviews.map((r) => [r.gate, r.decision, r.decidedBy])).toEqual([
      [1, 'approved', 'u_sponsor'],
      [2, 'approved', 'u_sponsor'],
    ]);
  });

  it('lead ticks, edits, adds and removes criteria; ticking records doneBy/doneAt', async () => {
    const s = as('u_lead');
    const c = await addCriterion(s, 'EHR', 'p_ehr_ph3', 'Increment 2 demonstrated');
    const t = await updateCriterion(s, 'EHR', c.id, {
      done: true,
      text: 'Increment 2 demonstrated to sponsor',
    });
    expect(t).toMatchObject({ done: true, doneBy: 'u_lead', text: 'Increment 2 demonstrated to sponsor' });
    expect(t.doneAt).toBeTruthy();
    const u = await updateCriterion(s, 'EHR', c.id, { done: false });
    expect(u.doneBy).toBeUndefined();
    await removeCriterion(s, 'EHR', c.id);
    expect(db().criteria.some((x) => x.id === c.id)).toBe(false);
    await expect(updateCriterion(as('u_team'), 'EHR', 'p_ehr_ph3_c0', { done: true })).rejects.toThrow(
      'Lead',
    );
    await expect(updateCriterion(as('u_sponsor'), 'EHR', 'p_ehr_ph3_c0', { done: true })).rejects.toThrow();
    await expect(updateCriterion(s, 'EHR', 'p_ehr_ph1_c0', { done: false })).rejects.toThrow(
      'already approved',
    );
  });

  it('blocks a review request on open criteria unless an override note is given', async () => {
    await expect(requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' })).rejects.toThrow(
      'not complete',
    );
    const r = await requestReview(as('u_lead'), 'EHR', {
      phaseId: 'p_ehr_ph3',
      overrideNote: 'Demo on Friday',
    });
    expect(r.overrideNote).toBe('Demo on Friday');
    expect(r.pack.overriddenCriteria).toHaveLength(1);
    expect(db().phases.find((p) => p.id === 'p_ehr_ph3')!.status).toBe('ready_for_review');
    expect(r.pack.deliverables.map((x) => x.name)).toContain('Appointment conversion sign-off');
    // Open EHR risks from the RAID log, highest score first; internal ones are stripped for clients.
    expect(r.pack.openRisks.length).toBeGreaterThan(0);
    expect(r.pack.openRisks[0]).toMatchObject({ id: 'rd_ehr_1', score: 16, visibility: 'shared' });
    expect(redactReview(sessionFor('u_sponsor').user, r).pack.openRisks.map((x) => x.id)).toEqual([
      'rd_ehr_1',
    ]);
    expect(r.pack.budget?.bac).toBe(480000);
    expect(db().audit.some((a) => a.action === 'gate.request_review')).toBe(true);
    await expect(
      requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3', overrideNote: 'x' }),
    ).rejects.toThrow();
  });

  it('pending reviews only reach the sponsor of the project’s org, without budget', async () => {
    await tickAll('p_ehr_ph3');
    await requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' });
    const pending = await listPendingReviews(as('u_sponsor'));
    expect(pending).toHaveLength(1);
    expect(pending[0].review.pack.budget).toBeUndefined();
    expect(await listPendingReviews(as('u_cmember'))).toEqual([]);
    expect(await listPendingReviews(as('u_rsponsor'))).toEqual([]);
    expect(await listPendingReviews(as('u_lead'))).toEqual([]);
  });

  it('only the sponsor decides, and only with a fresh re-auth; IP and audit are recorded', async () => {
    await tickAll('p_ehr_ph3');
    const r = await requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' });
    const approve = { decision: 'approved' as const };
    await expect(decideGate(as('u_cmember'), r.id, approve, fresh())).rejects.toMatchObject({ status: 403 });
    await expect(decideGate(as('u_lead'), r.id, approve, fresh())).rejects.toMatchObject({ status: 403 });
    await expect(decideGate(as('u_rsponsor'), r.id, approve, fresh())).rejects.toMatchObject({ status: 404 });
    await expect(decideGate(as('u_sponsor'), r.id, approve, { reauthAt: null })).rejects.toMatchObject({
      status: 401,
      message: 'reauth_required',
    });
    const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    await expect(decideGate(as('u_sponsor'), r.id, approve, { reauthAt: stale })).rejects.toMatchObject({
      status: 401,
    });
    const done = await decideGate(as('u_sponsor'), r.id, approve, fresh());
    expect(done).toMatchObject({
      status: 'decided',
      decision: 'approved',
      decidedBy: 'u_sponsor',
      ip: '203.0.113.50',
    });
    const phases = db().phases.filter((p) => p.projectId === 'p_ehr');
    expect(phases.find((p) => p.gate === 3)!.status).toBe('approved');
    expect(phases.find((p) => p.gate === 4)!.status).toBe('active');
    const audit = db().audit.find((a) => a.action === 'gate.decide')!;
    expect(audit).toMatchObject({ actorId: 'u_sponsor', ip: '203.0.113.50' });
    expect(
      db().activity.some((a) => a.action === 'gate.approved' && a.detail.includes('Grace Whitfield')),
    ).toBe(true);
    await expect(decideGate(as('u_sponsor'), r.id, approve, fresh())).rejects.toThrow('already been decided');
  });

  it('conditions become shared gate-condition tasks the sponsor can see', async () => {
    await tickAll('p_ehr_ph3');
    const r = await requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' });
    await expect(
      decideGate(as('u_sponsor'), r.id, { decision: 'approved_with_conditions', conditions: [] }, fresh()),
    ).rejects.toThrow('condition');
    const done = await decideGate(
      as('u_sponsor'),
      r.id,
      { decision: 'approved_with_conditions', conditions: ['Fix duplicate MRNs', 'Re-run dry-run'] },
      fresh(),
    );
    expect(done.conditionItemKeys).toHaveLength(2);
    const items = db().items.filter((i) => done.conditionItemKeys!.includes(i.key));
    expect(
      items.every(
        (i) => i.type === 'task' && i.visibility === 'shared' && i.labels.includes('gate-condition'),
      ),
    ).toBe(true);
    expect(items[0].phaseId).toBe('p_ehr_ph4');
    expect(db().phases.find((p) => p.id === 'p_ehr_ph3')!.status).toBe('approved_with_conditions');
  });

  it('rejection needs a reason and returns the phase to active with the reason visible', async () => {
    await tickAll('p_ehr_ph3');
    const r = await requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' });
    await expect(decideGate(as('u_sponsor'), r.id, { decision: 'rejected' }, fresh())).rejects.toThrow(
      'reason',
    );
    await decideGate(
      as('u_sponsor'),
      r.id,
      { decision: 'rejected', reason: 'UAT evidence missing' },
      fresh(),
    );
    expect(db().phases.find((p) => p.id === 'p_ehr_ph3')!.status).toBe('active');
    expect(db().phases.find((p) => p.id === 'p_ehr_ph4')!.status).toBe('not_started');
    const g = await getGates(as('u_sponsor'), 'EHR');
    expect(g.reviews.at(-1)).toMatchObject({ decision: 'rejected', reason: 'UAT evidence missing' });
    // The lead can fix and re-request.
    await expect(requestReview(as('u_lead'), 'EHR', { phaseId: 'p_ehr_ph3' })).resolves.toBeTruthy();
  });
});

describe('deliverables data layer', () => {
  beforeEach(() => resetDb());

  it('seeds the two EHR deliverables; clients only see the submitted one', async () => {
    const internal = await listDeliverables(as('u_lead'), 'EHR');
    expect(internal.map((x) => x.name)).toEqual([
      'Appointment conversion sign-off',
      'Provider templates — wave 1',
    ]);
    expect(internal[0].items.map((i) => i.key)).toEqual(['EHR-6', 'EHR-7', 'EHR-8']);
    const client = await listDeliverables(as('u_cmember'), 'EHR');
    expect(client.map((x) => x.name)).toEqual(['Appointment conversion sign-off']);
    expect((await listAwaitingAcceptance(as('u_sponsor'))).map((x) => x.id)).toEqual(['dl_ehr_1']);
    expect(await listAwaitingAcceptance(as('u_cviewer'))).toEqual([]);
    expect(await listAwaitingAcceptance(as('u_rsponsor'))).toEqual([]);
  });

  it('accepting every criterion accepts the deliverable, with audit and IP', async () => {
    await decideCriterion(as('u_cmember'), 'dl_ehr_1', 'dlc_ehr_1_1', { status: 'accepted' }, fresh());
    const d = await decideCriterion(
      as('u_sponsor'),
      'dl_ehr_1',
      'dlc_ehr_1_2',
      { status: 'accepted', note: 'Great' },
      fresh(),
    );
    expect(d.status).toBe('accepted');
    expect(d.criteria[1]).toMatchObject({ decidedBy: 'u_sponsor', note: 'Great', ip: '203.0.113.50' });
    expect(db().audit.filter((a) => a.action === 'deliverable.criterion_decide')).toHaveLength(2);
  });

  it('a rejection rejects the deliverable and reopens linked items as a system action', async () => {
    await expect(
      decideCriterion(as('u_cviewer'), 'dl_ehr_1', 'dlc_ehr_1_1', { status: 'rejected' }, fresh()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      decideCriterion(as('u_sponsor'), 'dl_ehr_1', 'dlc_ehr_1_1', { status: 'rejected' }, { reauthAt: null }),
    ).rejects.toMatchObject({ status: 401 });
    const d = await decideCriterion(
      as('u_sponsor'),
      'dl_ehr_1',
      'dlc_ehr_1_1',
      { status: 'rejected', note: 'Telehealth types missing' },
      fresh(),
    );
    expect(d.status).toBe('rejected');
    const items = db().items.filter((i) => ['EHR-6', 'EHR-7', 'EHR-8'].includes(i.key));
    expect(items.every((i) => i.status === 'in_progress')).toBe(true);
    expect(
      db()
        .activity.filter((a) => a.action === 'item.reopened')
        .map((a) => a.itemId),
    ).toEqual(['wi_ehr_6', 'wi_ehr_8']);
    // Locked until the team resubmits; resubmitting resets the decisions.
    await expect(
      decideCriterion(as('u_sponsor'), 'dl_ehr_1', 'dlc_ehr_1_2', { status: 'accepted' }, fresh()),
    ).rejects.toThrow('not awaiting');
    const again = await submitDeliverable(as('u_lead'), 'dl_ehr_1');
    expect(again.criteria.every((c) => c.status === 'pending')).toBe(true);
  });

  it('internal users create deliverables; clients cannot; internal ones never leak', async () => {
    const d = await createDeliverable(as('u_team'), 'EHR', {
      name: 'Internal QA pack',
      ownerId: 'u_team',
      visibility: 'internal',
      itemIds: ['wi_ehr_12'],
      criteria: ['Regression suite green'],
    });
    expect(d.status).toBe('draft');
    await expect(submitDeliverable(as('u_lead'), d.id)).rejects.toThrow('Share');
    expect((await listDeliverables(as('u_sponsor'), 'EHR')).some((x) => x.id === d.id)).toBe(false);
    await expect(
      createDeliverable(as('u_sponsor'), 'EHR', {
        name: 'x',
        ownerId: 'u_lead',
        visibility: 'shared',
        itemIds: [],
        criteria: [],
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createDeliverable(as('u_lead'), 'EHR', {
        name: 'x',
        ownerId: 'u_lead',
        visibility: 'shared',
        itemIds: ['wi_rvb_1'],
        criteria: [],
      }),
    ).rejects.toThrow('belong');
  });
});

describe('acceptance record', () => {
  beforeEach(() => resetDb());

  it('lists gate decisions and acceptances with name, time and IP, and audits each export', async () => {
    await decideCriterion(as('u_sponsor'), 'dl_ehr_1', 'dlc_ehr_1_1', { status: 'accepted' }, fresh());
    const rec = await buildAcceptanceRecord(as('u_sponsor'), 'EHR');
    expect(rec.clientName).toBe('Peachtree Clinic Group');
    expect(rec.rows.map((r) => [r.kind, r.by, r.ip])).toEqual([
      ['Gate decision', 'Grace Whitfield', '203.0.113.10'],
      ['Gate decision', 'Grace Whitfield', '203.0.113.10'],
      ['Deliverable acceptance', 'Grace Whitfield', '203.0.113.50'],
    ]);
    expect(db().audit.filter((a) => a.action === 'acceptance_record.export')).toHaveLength(1);
    await expect(buildAcceptanceRecord(as('u_cmember'), 'EHR')).rejects.toMatchObject({ status: 403 });
    await expect(buildAcceptanceRecord(as('u_rsponsor'), 'EHR')).rejects.toMatchObject({ status: 404 });
  });

  it('never includes internal deliverables, and renders a valid PDF', async () => {
    const d = db().deliverables.find((x) => x.id === 'dl_ehr_1')!;
    d.visibility = 'internal';
    d.criteria[0] = {
      ...d.criteria[0],
      status: 'accepted',
      decidedBy: 'u_sponsor',
      decidedAt: '2026-10-10T00:00:00Z',
    };
    const rec = await buildAcceptanceRecord(as('u_lead'), 'EHR');
    expect(rec.rows.some((r) => r.name.includes('Appointment conversion'))).toBe(false);
    const bytes = await renderAcceptanceRecord({ ...rec, projectName: 'Emoji 🚀 → test' });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(toWinAnsi('A — B → C 🚀')).toBe('A — B -> C ?');
  });
});

describe('re-auth cookie signing', () => {
  it('round-trips for the same user and rejects tampering or another user', () => {
    const t = signReauth('u_sponsor', '2026-10-12T12:00:00.000Z', 'k');
    expect(verifyReauth(t, 'u_sponsor', 'k')).toBe('2026-10-12T12:00:00.000Z');
    expect(verifyReauth(t, 'u_cmember', 'k')).toBeNull();
    expect(verifyReauth(t, 'u_sponsor', 'other')).toBeNull();
    expect(verifyReauth(t.replace('12:00', '12:30'), 'u_sponsor', 'k')).toBeNull();
    expect(verifyReauth(undefined, 'u_sponsor', 'k')).toBeNull();
    expect(verifyReauth('garbage', 'u_sponsor', 'k')).toBeNull();
  });
});
