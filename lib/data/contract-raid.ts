import { describe, expect, it } from 'vitest';
import type { CreateRaidInput } from '../raid-schemas';
import { useStores, type MakeStores, type Reset, type SessionFor } from './contract-support';

const DAY = 86_400_000;
const risk = (title: string, probability: number, impact: number): CreateRaidInput => ({
  projectId: 'EHR',
  kind: 'risk',
  title,
  category: 'technical',
  probability,
  impact,
});

/** RAID register rules every RaidStore must share (demo store and Postgres + RLS). */
export function runRaidContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} RAID contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    it('a client sees only shared entries of their own org’s projects', async () => {
      const { raid, repo } = st();
      const lead = await as('u_lead');
      const internal = await raid.createRaid(lead, {
        projectId: 'EHR',
        kind: 'assumption',
        title: 'Contract internal assumption',
      });
      const shared = await raid.createRaid(lead, {
        projectId: 'EHR',
        kind: 'assumption',
        title: 'Contract shared assumption',
        visibility: 'shared',
      });
      expect(internal.visibility).toBe('internal');

      const s = await as('u_sponsor');
      const list = await raid.listRaid(s, { projectId: 'EHR' });
      expect(list.every((e) => e.visibility === 'shared')).toBe(true);
      expect(list.some((e) => e.id === shared.id)).toBe(true);
      expect(list.some((e) => e.id === internal.id)).toBe(false);
      await expect(raid.getRaid(s, internal.id)).rejects.toThrow('not found');
      expect((await raid.getRaid(s, shared.id)).title).toBe('Contract shared assumption');
      await expect(raid.listRaid(s, { projectId: 'RVB' })).rejects.toThrow('not found');

      const own = new Set((await repo.listProjects(s)).map((p) => p.id));
      const all = await raid.listRaid(s, {});
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((e) => e.visibility === 'shared' && own.has(e.projectId))).toBe(true);

      const dev = await raid.listRaid(await as('u_dev'), { projectId: 'EHR' });
      expect(dev.some((e) => e.id === internal.id)).toBe(true);
      await expect(raid.listRaid(await as('u_assoc'), { projectId: 'RVB' })).rejects.toThrow('not found');
    });

    it('links to internal work items are never shown to clients', async () => {
      const { raid, repo } = st();
      const lead = await as('u_lead');
      const ehr7 = (await repo.getItem(lead, 'EHR-7')).item.id;
      const ehr12 = (await repo.getItem(lead, 'EHR-12')).item.id;
      const e = await raid.createRaid(lead, {
        ...risk('Linked shared risk', 2, 2),
        visibility: 'shared',
        linkedItemIds: [ehr7, 'EHR-12'],
      });
      expect([...e.linkedItemIds].sort()).toEqual([ehr7, ehr12].sort());
      await expect(
        raid.createRaid(lead, { ...risk('Bad link', 2, 2), linkedItemIds: ['RVB-2'] }),
      ).rejects.toThrow('not in this project');

      const s = await as('u_sponsor');
      expect((await raid.getRaid(s, e.id)).linkedItemIds).toEqual([ehr7]);
      expect((await raid.listRaid(s, { itemId: 'EHR-7' })).some((x) => x.id === e.id)).toBe(true);
      await expect(raid.listRaid(s, { itemId: 'EHR-12' })).rejects.toThrow('not found');
      expect((await raid.listRaid(lead, { itemId: 'EHR-12' })).some((x) => x.id === e.id)).toBe(true);
    });

    it('client users are read-only', async () => {
      const { raid } = st();
      const shared = await raid.createRaid(await as('u_lead'), {
        ...risk('Shared for clients', 2, 2),
        visibility: 'shared',
      });
      for (const p of ['u_sponsor', 'u_cmember', 'u_cviewer'] as const) {
        await expect(
          raid.createRaid(await as(p), { projectId: 'EHR', kind: 'assumption', title: 'x' }),
        ).rejects.toThrow('cannot change');
        await expect(raid.updateRaid(await as(p), shared.id, { title: 'x' })).rejects.toThrow(
          'cannot change',
        );
      }
      // Associates write on their own projects.
      const a = await raid.createRaid(await as('u_assoc'), {
        projectId: 'EHR',
        kind: 'dependency',
        title: 'Pharmacy vendor test account',
      });
      expect((await raid.updateRaid(await as('u_assoc'), a.id, { status: 'in_progress' })).status).toBe(
        'in_progress',
      );
    });

    it('a risk cannot be closed without a closure note', async () => {
      const { raid } = st();
      const lead = await as('u_lead');
      await expect(
        raid.createRaid(lead, { ...risk('Closed at birth', 2, 2), status: 'closed' }),
      ).rejects.toThrow('closure note');
      const r = await raid.createRaid(lead, risk('Vendor patch late', 2, 3));
      await expect(raid.updateRaid(lead, r.id, { status: 'closed' })).rejects.toThrow('closure note');
      await expect(raid.updateRaid(lead, r.id, { status: 'closed', closureNote: '  ' })).rejects.toThrow(
        'closure note',
      );
      expect((await raid.getRaid(lead, r.id)).status).toBe('open');

      const closed = await raid.updateRaid(lead, r.id, {
        status: 'closed',
        closureNote: 'Vendor shipped the patch',
      });
      expect(closed).toMatchObject({ status: 'closed', closureNote: 'Vendor shipped the patch' });
      expect(closed.closedAt).toBeTruthy();
      const reopened = await raid.updateRaid(lead, r.id, { status: 'open' });
      expect(reopened.closedAt).toBeNull();

      // Only risks need the note.
      const a = await raid.createRaid(lead, { projectId: 'EHR', kind: 'assumption', title: 'Assumed' });
      expect((await raid.updateRaid(lead, a.id, { status: 'closed' })).status).toBe('closed');
      await expect(
        raid.createRaid(lead, { projectId: 'EHR', kind: 'risk', title: 'No score' }),
      ).rejects.toThrow('probability and impact');
    });

    it('a risk scoring 15 or more escalates to steering and notifies the Lead once', async () => {
      const { raid } = st();
      const lead = await as('u_lead');
      const count = async () =>
        (await raid.listNotifications(lead)).filter((n) => n.kind === 'risk_escalated').length;
      const before = await count();

      const low = await raid.createRaid(lead, risk('Contract amber risk', 3, 4));
      expect(low).toMatchObject({ score: 12, escalate: false, band: 'amber' });
      expect(await count()).toBe(before);

      const high = await raid.createRaid(lead, risk('Contract steering risk', 3, 5));
      expect(high).toMatchObject({ score: 15, escalate: true, band: 'red' });
      const notes = await raid.listNotifications(lead);
      expect(
        notes.some((n) => n.kind === 'risk_escalated' && n.title.includes('Contract steering risk')),
      ).toBe(true);
      expect(await count()).toBe(before + 1);

      const raised = await raid.updateRaid(lead, low.id, { probability: 4 });
      expect(raised).toMatchObject({ score: 16, escalate: true });
      expect(await count()).toBe(before + 2);

      // Still above the threshold: no new notification.
      await raid.updateRaid(lead, high.id, { description: 'Re-assessed' });
      await raid.updateRaid(lead, high.id, { probability: 4 });
      expect(await count()).toBe(before + 2);
      expect((await raid.getRaid(lead, high.id)).escalate).toBe(true);
    });

    it('issues get an SLA from their severity', async () => {
      const { raid } = st();
      const lead = await as('u_lead');
      await expect(
        raid.createRaid(lead, { projectId: 'EHR', kind: 'issue', title: 'No severity' }),
      ).rejects.toThrow('severity');
      const i = await raid.createRaid(lead, {
        projectId: 'EHR',
        kind: 'issue',
        title: 'Interface down',
        severity: 'critical',
      });
      expect(Date.parse(i.slaDue!) - Date.parse(i.createdAt)).toBe(2 * DAY);
      expect(i.slaBreached).toBe(false);
      expect(i.score).toBeNull();
    });

    it('stale issues notify the Lead and Admins, at most once a day', async () => {
      const { raid } = st();
      const lead = await as('u_lead');
      const admin = await as('u_admin');
      const issue = await raid.createRaid(lead, {
        projectId: 'EHR',
        kind: 'issue',
        title: 'Contract stale issue',
        severity: 'minor',
      });
      const later = new Date(Date.now() + 11 * DAY);
      await expect(raid.escalateStaleIssues(await as('u_dev'), later)).rejects.toThrow('Only Admins');

      // The system-wide cron run (no session).
      const first = await raid.escalateStaleIssues(null, later);
      expect(first.escalated).toContain(issue.id);
      for (const s of [lead, admin])
        expect(
          (await raid.listNotifications(s)).some(
            (n) => n.kind === 'sla_breach' && n.title.includes('Contract stale issue'),
          ),
        ).toBe(true);
      expect(
        (await raid.listNotifications(await as('u_dev'))).some((n) =>
          n.title.includes('Contract stale issue'),
        ),
      ).toBe(false);

      const again = await raid.escalateStaleIssues(lead, new Date(later.getTime() + 3_600_000));
      expect(again.escalated).not.toContain(issue.id);
      const nextDay = await raid.escalateStaleIssues(lead, new Date(later.getTime() + 25 * 3_600_000));
      expect(nextDay.escalated).toContain(issue.id);
      // Escalating is bookkeeping, not an update: the issue stays stale.
      expect((await raid.getRaid(lead, issue.id, later)).stale).toBe(true);
    });

    it('notifications are personal and marking read only touches the caller’s own', async () => {
      const { raid } = st();
      const lead = await as('u_lead');
      await raid.createRaid(lead, risk('Contract notify risk', 5, 5));
      const mine = await raid.listNotifications(lead);
      const n = mine.find((x) => x.title.includes('Contract notify risk'))!;
      expect(n.readAt).toBeNull();
      expect(n.userId).toBe(lead.user.id);
      expect((await raid.listNotifications(await as('u_sponsor'))).some((x) => x.id === n.id)).toBe(false);

      // Another user's "mark read" never reaches the lead's notification.
      await raid.markNotificationsRead(await as('u_sponsor'), [n.id]);
      expect((await raid.listNotifications(lead)).find((x) => x.id === n.id)!.readAt).toBeNull();
      const after = await raid.markNotificationsRead(lead, [n.id]);
      expect(after.find((x) => x.id === n.id)!.readAt).toBeTruthy();
      const all = await raid.markNotificationsRead(lead);
      expect(all.every((x) => x.readAt)).toBe(true);
    });
  });
}
