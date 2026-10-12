import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import { getProjectMetrics } from './metrics';
import {
  generateDraft,
  getReport,
  listReports,
  publishCheck,
  publishReport,
  reportGrid,
  updateReport,
} from './reports';
import { listNotifications } from './raid';

const as = (id: string) => sessionFor(id);
const NOW = new Date('2026-10-14T12:00:00Z');

beforeEach(() => resetDb());

describe('Pulse seed', () => {
  it('archives four older completed EHR sprints without touching live sprints or items', () => {
    const d = db();
    expect(d.metricsArchive.sprints).toHaveLength(4);
    expect(d.metricsArchive.sprints.every((s) => s.status === 'completed')).toBe(true);
    expect(d.sprints.filter((s) => s.projectId === 'p_ehr')).toHaveLength(3);
    const all = [...d.items, ...d.metricsArchive.items];
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    for (const h of d.statusHistory) expect(all.some((i) => i.id === h.itemId)).toBe(true);
    for (const c of d.sprintCommitments)
      for (const id of c.itemIds) expect(all.some((i) => i.id === id)).toBe(true);
  });

  it('history ends in each item’s current status', () => {
    const d = db();
    const all = [...d.items, ...d.metricsArchive.items];
    const last = new Map<string, string>();
    for (const h of [...d.statusHistory].sort((a, b) => a.at.localeCompare(b.at))) last.set(h.itemId, h.to);
    for (const [id, status] of last) expect(all.find((i) => i.id === id)!.status).toBe(status);
  });
});

describe('agile metrics on the demo project', () => {
  it('velocity covers six sprints with believable numbers and the active sprint burns down', () => {
    const m = getProjectMetrics(as('u_lead'), 'EHR', NOW);
    expect(m.velocity).toHaveLength(6);
    expect(m.velocity.map((v) => [v.committed, v.completed])).toEqual([
      [15, 10],
      [21, 18],
      [21, 19],
      [13, 8],
      [19, 11],
      [16, 0],
    ]);
    expect(m.velocity.at(-1)!.inProgress).toBe(true);
    expect(m.averageVelocity).toBe(13.2);
    expect(m.burndown).toMatchObject({ sprint: 'EHR Sprint 2', total: 19 });
    expect(m.burndown!.points.find((p) => p.day === '2026-10-09')!.actual).toBe(19);
    expect(m.cycleTime.points).toHaveLength(20);
    expect(m.cycleTime.p85).toBeGreaterThanOrEqual(m.cycleTime.p50);
    expect(m.cumulativeFlow).toHaveLength(30);
    expect(m.throughput.reduce((t, w) => t + w.count, 0)).toBe(19); // 10 weeks: Kick-off week is out
  });

  it('moving an item to Done records history and adds to this week’s throughput', async () => {
    const before = getProjectMetrics(as('u_dev'), 'EHR').throughput.at(-1)!.count;
    await memoryRepo.updateItem(as('u_dev'), 'EHR-7', { status: 'done' });
    const h = db().statusHistory.at(-1)!;
    expect(h).toMatchObject({ itemId: 'wi_ehr_7', from: 'in_progress', to: 'done', actorId: 'u_dev' });
    expect(getProjectMetrics(as('u_dev'), 'EHR').throughput.at(-1)!.count).toBe(before + 1);
    // A non-status edit records nothing.
    const n = db().statusHistory.length;
    await memoryRepo.updateItem(as('u_dev'), 'EHR-7', { title: 'Renamed' });
    expect(db().statusHistory).toHaveLength(n);
  });

  it('is internal only and respects project visibility', () => {
    expect(() => getProjectMetrics(as('u_sponsor'), 'EHR')).toThrow(/internal/);
    expect(() => getProjectMetrics(as('u_rsponsor'), 'EHR')).toThrow(/not found/);
    expect(() => getProjectMetrics(as('u_assoc'), 'RVB')).toThrow(/not found/);
  });
});

describe('weekly status reports', () => {
  it('lead generates a draft; generating again returns the same draft', async () => {
    const r = await generateDraft(as('u_lead'), 'EHR', undefined, NOW);
    expect(r).toMatchObject({
      weekStart: '2026-10-12',
      weekEnd: '2026-10-16',
      status: 'draft',
      canPublish: true,
    });
    expect(r.sections.budget).toContain('$480,000');
    expect(r.sections.risks).toContain('Integration estimate may be low'); // internal, in the draft
    expect((await generateDraft(as('u_lead'), 'EHR', '2026-10-14', NOW)).id).toBe(r.id);
  });

  it('team members draft and edit but never see the budget or publish', async () => {
    const r = await generateDraft(as('u_team'), 'EHR', undefined, NOW);
    expect(r.budgetHidden).toBe(true);
    expect(r.sections.budget).toBeUndefined();
    expect(r.canPublish).toBe(false);
    const edited = await updateReport(as('u_team'), r.id, { sections: { scope: '<p>Edited</p>' } });
    expect(edited.sections.scope).toBe('<p>Edited</p>');
    await expect(updateReport(as('u_team'), r.id, { sections: { budget: '<p>x</p>' } })).rejects.toThrow(
      /budget/,
    );
    await expect(publishReport(as('u_team'), r.id)).rejects.toMatchObject({ status: 403 });
    await expect(publishCheck(as('u_dev'), r.id)).rejects.toMatchObject({ status: 403 });
  });

  it('publishing strips internal content, audits, and notifies every client user of the org', async () => {
    const r = await generateDraft(as('u_lead'), 'EHR', undefined, NOW);
    const check = await publishCheck(as('u_lead'), r.id);
    expect(check.recipients).toBe(3);
    expect(check.removed.map((x) => x.label)).toEqual(
      expect.arrayContaining(['Budget section (internal only)', 'Risk: Integration estimate may be low']),
    );
    const pub = await publishReport(as('u_lead'), r.id, {}, NOW);
    expect(pub.status).toBe('published');
    expect(pub.canEdit).toBe(false);
    expect(db().audit.some((a) => a.action === 'status_report.publish' && a.entityId === r.id)).toBe(true);
    for (const u of ['u_sponsor', 'u_cmember', 'u_cviewer'])
      expect((await listNotifications(as(u))).some((n) => n.kind === 'status_report_published')).toBe(true);
    expect((await listNotifications(as('u_rsponsor'))).length).toBe(0);

    const client = await getReport(as('u_sponsor'), r.id);
    const text = JSON.stringify(client);
    expect(client.sections.budget).toBeUndefined();
    expect(text).not.toContain('480,000');
    for (const e of db().raid.filter((x) => x.projectId === 'p_ehr' && x.visibility === 'internal'))
      expect(text).not.toContain(e.title);
    for (const i of db().items.filter((x) => x.projectId === 'p_ehr' && x.visibility === 'internal'))
      expect(text).not.toContain(i.title);
    expect(client.removed).toEqual([]);

    await expect(updateReport(as('u_lead'), r.id, { rag: 'red' })).rejects.toThrow(/Published/);
    await expect(publishReport(as('u_lead'), r.id)).rejects.toThrow(/already published/);
    await expect(generateDraft(as('u_lead'), 'EHR', undefined, NOW)).rejects.toThrow(/already published/);
  });

  it('a shared budget reaches the client copy', async () => {
    const r = await generateDraft(as('u_admin'), 'EHR', undefined, NOW);
    await publishReport(as('u_admin'), r.id, { shareBudget: true }, NOW);
    expect((await getReport(as('u_sponsor'), r.id)).sections.budget).toContain('$480,000');
  });

  it('clients see published reports of their own org only, never drafts', async () => {
    const draft = await generateDraft(as('u_lead'), 'EHR', undefined, NOW);
    expect((await listReports(as('u_sponsor'))).map((r) => r.id)).toEqual(['sr_ehr_1005']);
    await expect(getReport(as('u_sponsor'), draft.id)).rejects.toThrow(/not found/);
    await expect(getReport(as('u_rsponsor'), 'sr_ehr_1005')).rejects.toThrow(/not found/);
    await expect(generateDraft(as('u_sponsor'), 'EHR')).rejects.toMatchObject({ status: 403 });
    await expect(reportGrid(as('u_sponsor'))).rejects.toMatchObject({ status: 403 });
    const seeded = await getReport(as('u_sponsor'), 'sr_ehr_1005');
    expect(JSON.stringify(seeded)).not.toMatch(/Integration estimate|480,000|EHR-12/);
  });

  it('the grid lists visible projects × four weeks', async () => {
    const g = await reportGrid(as('u_assoc'), 4, NOW);
    expect(g.weeks).toEqual(['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21']);
    expect(g.projects.map((p) => p.key)).toEqual(['EHR']);
    expect(g.projects[0]).toMatchObject({ canDraft: true, canPublish: false });
    expect(g.reports.map((r) => r.id)).toEqual(['sr_ehr_1005']);
  });
});
