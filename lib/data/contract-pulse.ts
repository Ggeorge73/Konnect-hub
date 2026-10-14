import { describe, expect, it } from 'vitest';
import { useStores, type MakeStores, type Reset, type SessionFor } from './contract-support';

/** A Monday far from the seeded reports, so every store starts this week empty. */
const WEEK = '2027-03-01';

/** Agile metrics and weekly status report rules every Pulse store must share (AGL-01, RPT-01). */
export function runPulseContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} pulse contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    it('metrics are internal only, respect project visibility, and count a move to Done', async () => {
      const { metrics, repo } = st();
      await expect(metrics.getProjectMetrics(await as('u_sponsor'), 'EHR')).rejects.toThrow(/internal/);
      await expect(metrics.getProjectMetrics(await as('u_rsponsor'), 'EHR')).rejects.toThrow(/not found/);
      await expect(metrics.getProjectMetrics(await as('u_assoc'), 'RVB')).rejects.toThrow(/not found/);

      const dev = await as('u_dev');
      const item = await repo.createItem(await as('u_lead'), {
        projectId: 'EHR',
        type: 'task',
        title: 'Contract throughput',
        status: 'in_progress',
        estimate: 3,
      });
      const before = await metrics.getProjectMetrics(dev, 'EHR');
      expect(before.today).toBe(new Date().toISOString().slice(0, 10));
      await repo.updateItem(dev, item.key, { status: 'done' });
      const after = await metrics.getProjectMetrics(dev, 'EHR');
      expect(after.throughput.at(-1)!.count).toBe(before.throughput.at(-1)!.count + 1);
      expect(after.cycleTime.points.length).toBeGreaterThanOrEqual(before.cycleTime.points.length);
    });

    it('drafts are internal; the budget section is for Leads and Admins only', async () => {
      const { reports } = st();
      const dev = await as('u_dev');
      const lead = await as('u_lead');
      const sponsor = await as('u_sponsor');
      await expect(reports.generateDraft(sponsor, 'EHR', WEEK)).rejects.toThrow('delivery team');

      const draft = await reports.generateDraft(dev, 'EHR', '2027-03-03');
      expect(draft).toMatchObject({
        projectKey: 'EHR',
        weekStart: WEEK,
        weekEnd: '2027-03-05',
        status: 'draft',
      });
      expect([draft.canEdit, draft.canPublish, draft.budgetHidden]).toEqual([true, false, true]);
      expect(draft.sections.budget).toBeUndefined();
      expect(draft.sections.scope).toContain('Completed this week');
      expect((await reports.generateDraft(lead, 'EHR', WEEK)).id).toBe(draft.id);

      const full = await reports.getReport(lead, draft.id);
      expect(full.sections.budget).toContain('Budget at completion');
      expect([full.canPublish, full.budgetHidden]).toEqual([true, false]);

      await expect(reports.getReport(sponsor, draft.id)).rejects.toThrow('not found');
      expect((await reports.listReports(sponsor, { project: 'EHR' })).some((r) => r.id === draft.id)).toBe(
        false,
      );
      expect((await reports.listReports(dev, { project: 'EHR' })).some((r) => r.id === draft.id)).toBe(true);
      await expect(reports.updateReport(dev, draft.id, { sections: { budget: '<p>x</p>' } })).rejects.toThrow(
        'Only Leads and Admins',
      );
      const edited = await reports.updateReport(dev, draft.id, {
        sections: { scope: '<p>Edited by the team.</p>' },
        rag: 'amber',
        ragReason: ' Two-day slip ',
      });
      expect([edited.sections.scope, edited.rag, edited.ragReason]).toEqual([
        '<p>Edited by the team.</p>',
        'amber',
        'Two-day slip',
      ]);
      await reports.updateReport(lead, draft.id, { sections: { budget: '<p>Budget: on track.</p>' } });
      expect((await reports.getReport(lead, draft.id)).sections.budget).toBe('<p>Budget: on track.</p>');

      await expect(reports.reportGrid(sponsor)).rejects.toThrow('portal');
      const grid = await reports.reportGrid(lead);
      expect(grid.weeks).toHaveLength(4);
      expect(grid.projects.find((p) => p.key === 'EHR')).toMatchObject({ canDraft: true, canPublish: true });
    });

    it('publishing freezes a client copy without internal content and notifies the client users', async () => {
      const { reports, repo, signal } = st();
      const lead = await as('u_lead');
      const sponsor = await as('u_sponsor');
      const secret = await repo.createItem(lead, {
        projectId: 'EHR',
        type: 'task',
        title: 'Contract secret vendor dispute',
      });
      const draft = await reports.generateDraft(lead, 'EHR', WEEK);
      await reports.updateReport(lead, draft.id, {
        sections: {
          scope: `<ul><li><p>${secret.key} Contract secret vendor dispute</p></li><li><p>Templates signed off</p></li></ul>`,
        },
        ragReason: 'On plan.',
      });

      await expect(reports.publishCheck(await as('u_dev'), draft.id)).rejects.toThrow(
        'Only the project Lead',
      );
      const check = await reports.publishCheck(lead, draft.id);
      expect(check.recipients).toBe(3);
      expect(check.removed.map((r) => r.kind)).toEqual(expect.arrayContaining(['budget', 'item']));

      await expect(reports.publishReport(await as('u_dev'), draft.id)).rejects.toThrow(
        'Only the project Lead',
      );
      const published = await reports.publishReport(lead, draft.id, { shareBudget: false });
      expect(published).toMatchObject({ status: 'published', canEdit: false, canPublish: false });
      expect(published.publishedAt).toBeTruthy();
      expect(published.publishedByName).toBe('Lara Bennett');
      expect(published.removed.length).toBeGreaterThanOrEqual(2);

      const client = await reports.getReport(sponsor, draft.id);
      expect(client.sections.budget).toBeUndefined();
      expect(client.sections.scope).toContain('Templates signed off');
      expect(JSON.stringify(client)).not.toContain('Contract secret');
      expect(client.removed).toEqual([]);
      expect(client.ragReason).toBe('On plan.');
      expect((await reports.listReports(sponsor, { project: 'EHR' })).some((r) => r.id === draft.id)).toBe(
        true,
      );
      await expect(reports.getReport(await as('u_rsponsor'), draft.id)).rejects.toThrow('not found');

      const notes = await signal.listNotifications(sponsor);
      expect(
        notes.some(
          (n) => n.kind === 'status_report_published' && n.href === `/portal/EHR/reports/${draft.id}`,
        ),
      ).toBe(true);

      await expect(reports.publishReport(lead, draft.id)).rejects.toThrow('already published');
      await expect(reports.updateReport(lead, draft.id, { rag: 'red' })).rejects.toThrow('cannot be edited');
      await expect(reports.generateDraft(lead, 'EHR', WEEK)).rejects.toThrow('already published');
    });
  });
}
