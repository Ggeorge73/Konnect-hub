import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo as repo, resetDb } from '../data/memory';
import { sessionFor } from '../session';
import { generateDraft, getReport } from '../data/reports';
import { listRaid } from '../data/raid';
import { createTokenBucket, setAiRateLimiter } from './rate-limit';
import {
  acceptRiskSuggestion,
  createItemsFromNotes,
  dismissRiskSuggestion,
  draftStatusReport,
  extractMeetingNotes,
  getAiStatus,
  setAiEnabled,
  suggestRisks,
  summarizeThread,
} from './service';

const as = (id: string) => sessionFor(id);
const lead = () => as('u_lead');

async function freshProject(key: string) {
  const peachtree = (await repo.listOrgs(lead())).find((o) => o.name === 'Peachtree Clinic Group')!;
  return repo.createProject(lead(), {
    name: `AI ${key}`,
    key,
    clientOrgId: peachtree.id,
    leadId: 'u_lead',
    startDate: '2026-10-01',
    targetDate: '2027-03-01',
    methodology: 'hybrid',
    contractType: 'fixed_fee',
    bac: 75000,
    description: '',
    templateId: 'kdf-hybrid',
  });
}

const aiCalls = () => db().audit.filter((a) => a.action === 'ai.call');

describe('AI service (demo store, fake client)', () => {
  beforeEach(() => {
    resetDb();
    setAiRateLimiter(undefined);
  });

  it('is off by default: every feature refuses until the Lead turns it on', async () => {
    await freshProject('OFF');
    const st = await getAiStatus(lead(), 'OFF');
    expect(st).toMatchObject({ enabled: false, canToggle: true, provider: 'fake', model: 'konnect-fake-1' });
    await expect(suggestRisks(lead(), 'OFF')).rejects.toMatchObject({ status: 409 });
    await expect(extractMeetingNotes(lead(), repo, 'OFF', '- do it')).rejects.toThrow('AI assist is off');
    await expect(setAiEnabled(as('u_team'), 'EHR', false)).rejects.toMatchObject({ status: 403 });
    expect((await setAiEnabled(lead(), 'OFF', true)).enabled).toBe(true);
    expect(
      db().audit.filter((a) => a.action === 'ai.settings.update' && a.entityId === st.projectId),
    ).toHaveLength(1);
  });

  it('drafts the status report as a preview: nothing is saved, and the call is audited without content', async () => {
    const report = await generateDraft(lead(), 'EHR', '2026-10-12');
    const before = (await getReport(lead(), report.id)).sections;
    const draft = await draftStatusReport(lead(), report.id);
    expect(draft.provider).toBe('fake');
    expect(Object.keys(draft.sections).sort()).toEqual(Object.keys(before).sort());
    expect(draft.sections.scope).toMatch(/^<p><strong>Scope in brief:<\/strong>/);
    expect((await getReport(lead(), report.id)).sections).toEqual(before);
    const [audit] = aiCalls();
    expect(audit).toMatchObject({ actorId: 'u_lead', entityId: 'status_report' });
    expect(audit.after).toMatchObject({ feature: 'status_report', model: 'konnect-fake-1', outcome: 'ok' });
    expect((audit.after as { inputTokens: number }).inputTokens).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('Completed this week');
    // A team member who cannot see the budget gets no budget section to draft.
    const team = await draftStatusReport(as('u_team'), report.id);
    expect(team.sections.budget).toBeUndefined();
    await expect(draftStatusReport(as('u_sponsor'), report.id)).rejects.toThrow();
  });

  it('suggests risks from stalled items; accepting creates a linked internal risk; dismissals stick', async () => {
    await freshProject('RSK');
    await setAiEnabled(lead(), 'RSK', true);
    const a = await repo.createItem(lead(), {
      projectId: 'RSK',
      type: 'task',
      title: 'Configure interface engine',
    });
    const b = await repo.createItem(lead(), { projectId: 'RSK', type: 'task', title: 'Load test plan' });
    await repo.updateItem(lead(), a.id, { status: 'in_progress' });
    await repo.updateItem(lead(), b.id, { status: 'in_progress' });
    expect((await suggestRisks(lead(), 'RSK')).suggestions).toEqual([]); // nothing stalled today
    expect(aiCalls()).toHaveLength(0); // no signals, no model call

    const res = await suggestRisks(lead(), 'RSK', { lookaheadDays: 14 });
    expect(res.signals.map((s) => s.kind)).toEqual(['stalled', 'stalled']);
    const sug = res.suggestions.find((s) => s.linkedItemKeys.includes(a.key))!;
    expect(sug).toMatchObject({ category: 'schedule', signalKeys: [`stalled:${a.id}`] });

    const risk = await acceptRiskSuggestion(lead(), 'RSK', { ...sug, title: `${sug.title} (reviewed)` });
    expect(risk).toMatchObject({
      kind: 'risk',
      visibility: 'internal',
      linkedItemIds: [a.id],
      ownerId: 'u_lead',
    });
    expect((await listRaid(lead(), { itemId: a.key })).map((r) => r.id)).toEqual([risk.id]);

    const other = res.suggestions.find((s) => s.linkedItemKeys.includes(b.key))!;
    expect((await dismissRiskSuggestion(lead(), 'RSK', other.signalKeys)).dismissed).toEqual(
      other.signalKeys,
    );
    const again = await suggestRisks(lead(), 'RSK', { lookaheadDays: 14 });
    expect(again.signals).toEqual([]);
    expect(again.suggestions).toEqual([]);
    await expect(suggestRisks(as('u_sponsor'), 'RSK')).rejects.toMatchObject({ status: 403 });
  });

  it('turns meeting notes into a preview, then creates only the ticked rows as internal items', async () => {
    const notes =
      '- Lara to confirm cutover date by Friday\n- Adeoba fix the login error\n- Tiara: write UAT scripts';
    const preview = await extractMeetingNotes(lead(), repo, 'EHR', notes, new Date('2026-10-14T10:00:00Z'));
    expect(preview.items).toHaveLength(3);
    expect(preview.items.map((i) => i.assigneeId)).toEqual(['u_lead', 'u_dev', 'u_team']);
    const before = db().items.length;
    expect(db().items.length).toBe(before);
    const created = await createItemsFromNotes(lead(), repo, 'EHR', [preview.items[0], preview.items[2]]);
    expect(created).toHaveLength(2);
    expect(created.every((i) => i.visibility === 'internal' && i.status === 'backlog')).toBe(true);
    expect(db().items.length).toBe(before + 2);
    await expect(
      createItemsFromNotes(lead(), repo, 'EHR', [{ ...preview.items[0], assigneeId: 'u_rsponsor' }]),
    ).rejects.toThrow('members of this project');
    await expect(extractMeetingNotes(as('u_cmember'), repo, 'EHR', notes)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('summarises a thread; a client summary is built from shared comments only', async () => {
    const item = await repo.createItem(lead(), {
      projectId: 'EHR',
      type: 'task',
      title: 'Thread',
      visibility: 'shared',
    });
    for (let i = 1; i <= 6; i++)
      await repo.addComment(lead(), { itemId: item.id, body: `Shared update ${i}`, visibility: 'shared' });
    await repo.addComment(lead(), {
      itemId: item.id,
      body: 'SECRET-MARGIN internal note',
      visibility: 'internal',
    });
    const internal = await summarizeThread(lead(), repo, item.key);
    expect(internal).toMatchObject({ scope: 'all', commentCount: 7 });
    expect(JSON.stringify(internal)).toContain('SECRET-MARGIN');
    for (const p of ['u_sponsor', 'u_cviewer']) {
      const client = await summarizeThread(as(p), repo, item.key);
      expect(client).toMatchObject({ scope: 'shared', commentCount: 6 });
      expect(JSON.stringify(client)).not.toContain('SECRET-MARGIN');
    }
    const short = await repo.createItem(lead(), { projectId: 'EHR', type: 'task', title: 'Short' });
    await expect(summarizeThread(lead(), repo, short.key)).rejects.toThrow('more than 5 comments');
  });

  it('rate-limits AI calls per user (429)', async () => {
    setAiRateLimiter(createTokenBucket({ capacity: 2, perMs: 60_000 }));
    const report = await generateDraft(lead(), 'EHR', '2026-10-12');
    await draftStatusReport(lead(), report.id);
    await draftStatusReport(lead(), report.id);
    await expect(draftStatusReport(lead(), report.id)).rejects.toMatchObject({ status: 429 });
    await expect(draftStatusReport(as('u_admin'), report.id)).resolves.toBeTruthy();
  });
});
