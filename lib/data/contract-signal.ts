import { beforeEach, describe, expect, it } from 'vitest';
import type { Persona } from './contract';
import type { CreateItemInput } from './repo';
import { useStores, type MakeStores, type Reset, type SessionFor } from './contract-support';

/**
 * Notification center, watchers, preferences and the dispatch from every write path (NTF-01).
 * Each store must notify from its own writes: the demo store through notify(), the Postgres
 * stores through pgNotify() in the same transaction as the write.
 */
const PERSONAS: Persona[] = [
  'u_admin',
  'u_lead',
  'u_team',
  'u_dev',
  'u_assoc',
  'u_sponsor',
  'u_cmember',
  'u_cviewer',
  'u_rsponsor',
];

export function runSignalContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} signal contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);
    // Seeded notifications differ between stores: each scenario only looks at what it caused.
    let seen = new Set<string>();
    beforeEach(async () => {
      seen = new Set();
      for (const p of PERSONAS)
        for (const n of await st().signal.listNotifications(await as(p))) seen.add(n.id);
    });
    const mine = async (p: Persona) =>
      (await st().signal.listNotifications(await as(p))).filter((n) => !seen.has(n.id));
    const kinds = async (p: Persona) => (await mine(p)).map((n) => n.kind);

    async function item(extra: Partial<CreateItemInput> = {}) {
      return st().repo.createItem(await as('u_lead'), {
        projectId: 'EHR',
        type: 'task',
        title: 'Contract signal item',
        visibility: 'shared',
        ...extra,
      });
    }

    it('@mentions notify; an internal comment never reaches a client, a shared one links to the portal', async () => {
      const { repo } = st();
      const shared = await item();
      await repo.addComment(await as('u_dev'), {
        itemId: shared.key,
        body: 'Internal: @Grace may push back, @Tiara heads up',
        visibility: 'internal',
      });
      expect(await mine('u_sponsor')).toEqual([]);
      const [n] = await mine('u_team');
      expect(n).toMatchObject({
        kind: 'mention',
        readAt: null,
        href: `/projects/EHR/board?item=${shared.key}`,
        title: `Adeoba mentioned you on ${shared.key}`,
      });

      await repo.addComment(await as('u_lead'), {
        itemId: shared.key,
        body: '@Grace the template is ready for you',
        visibility: 'shared',
      });
      const [c] = await mine('u_sponsor');
      expect(c).toMatchObject({ kind: 'mention', href: `/portal/EHR?item=${shared.key}` });

      const internal = await item({ visibility: 'internal' });
      await repo.addComment(await as('u_lead'), {
        itemId: internal.key,
        body: '@Grace fyi',
        visibility: 'shared',
      });
      expect(await mine('u_sponsor')).toHaveLength(1);
    });

    it('reporter, assignee and commenters watch automatically; the toggle unwatches', async () => {
      const { repo, signal } = st();
      const dev = await as('u_dev');
      const it1 = await item({ assigneeId: dev.user.id });
      expect((await signal.getWatch(await as('u_lead'), it1.id)).watching).toBe(true);
      expect((await signal.getWatch(dev, it1.id)).watching).toBe(true);
      const team = await as('u_team');
      expect((await signal.getWatch(team, it1.id)).watching).toBe(false);
      await repo.addComment(team, { itemId: it1.key, body: 'Looks good', visibility: 'internal' });
      expect(await signal.getWatch(team, it1.id)).toEqual({ watching: true, count: 3 });
      expect(await signal.setWatch(team, it1.id, false)).toEqual({ watching: false, count: 2 });
      expect(await signal.setWatch(team, it1.id, true)).toEqual({ watching: true, count: 3 });
    });

    it('assignment notifies the assignee; status changes reach watchers except the mover', async () => {
      const { repo } = st();
      const dev = await as('u_dev');
      const it1 = await item({ assigneeId: dev.user.id, status: 'ready' });
      expect(await kinds('u_dev')).toEqual(['assignment']);
      expect((await mine('u_dev'))[0].title).toContain(it1.key);
      // Assigning yourself is not news.
      const team = await as('u_team');
      await repo.updateItem(team, it1.key, { assigneeId: team.user.id });
      expect(await kinds('u_team')).toEqual([]);

      await repo.updateItem(dev, it1.key, { status: 'in_progress' });
      expect(await kinds('u_lead')).toEqual(['status_change']); // reporter
      expect((await mine('u_lead'))[0].title).toBe(`${it1.key} moved to In Progress: Contract signal item`);
      expect(await kinds('u_dev')).toEqual(['assignment']); // the mover hears nothing new
    });

    it('a client watching a shared item hears about its moves, but never once it is internal', async () => {
      const { repo, signal } = st();
      const lead = await as('u_lead');
      const sponsor = await as('u_sponsor');
      const it1 = await item({ status: 'ready' });
      await signal.setWatch(sponsor, it1.id, true);
      expect((await signal.getWatch(sponsor, it1.id)).watching).toBe(true);
      await repo.updateItem(lead, it1.key, { status: 'in_progress' });
      expect((await mine('u_sponsor')).map((n) => [n.kind, n.href])).toEqual([
        ['status_change', `/portal/EHR?item=${it1.key}`],
      ]);
      await repo.updateItem(lead, it1.key, { visibility: 'internal' });
      await repo.updateItem(lead, it1.key, { status: 'in_review' });
      expect(await mine('u_sponsor')).toHaveLength(1);
    });

    it('preferences: off drops a kind; unknown channels and internal-only kinds for clients are rejected', async () => {
      const { repo, signal } = st();
      const dev = await as('u_dev');
      expect((await signal.getPreferences(dev)).mention).toBe('email');
      expect((await signal.setPreferences(dev, { mention: 'off' })).mention).toBe('off');
      expect((await signal.getPreferences(dev)).mention).toBe('off');
      await repo.addComment(await as('u_team'), {
        itemId: (await item()).key,
        body: '@Adeoba please check',
        visibility: 'internal',
      });
      expect(await kinds('u_dev')).toEqual([]);

      await expect(signal.setPreferences(dev, { mention: 'pager' as never })).rejects.toThrow(
        'Unknown channel',
      );
      const sponsor = await as('u_sponsor');
      await expect(signal.setPreferences(sponsor, { risk_escalated: 'email' })).rejects.toThrow(
        'Unknown notification type',
      );
      expect(Object.keys(await signal.getPreferences(sponsor))).not.toContain('risk_escalated');
      // Preferences are personal.
      expect((await signal.getPreferences(await as('u_team'))).mention).toBe('email');
    });

    it('mark read touches only the caller’s notifications', async () => {
      const { repo, signal } = st();
      const it1 = await item();
      await repo.addComment(await as('u_dev'), {
        itemId: it1.key,
        body: '@Tiara @Lara',
        visibility: 'internal',
      });
      const team = await as('u_team');
      const [n] = await mine('u_team');
      expect(
        (await signal.markNotificationsRead(team, [n.id])).find((x) => x.id === n.id)!.readAt,
      ).toBeTruthy();
      expect((await mine('u_lead')).find((x) => x.kind === 'mention')!.readAt).toBeNull();
      expect((await signal.markNotificationsRead(await as('u_lead'))).every((x) => x.readAt)).toBe(true);
    });

    it('gate requests reach the Sponsor; submitted deliverables reach the client reviewers', async () => {
      const { gates, deliverables, repo } = st();
      const lead = await as('u_lead');
      const phase = (await gates.getGates(lead, 'EHR')).phases.find((p) => p.gate === 3)!;
      const review = await gates.requestReview(lead, 'EHR', {
        phaseId: phase.id,
        overrideNote: 'Contract demo',
      });
      expect((await mine('u_sponsor')).map((n) => [n.kind, n.href])).toEqual([
        ['gate_requested', `/portal?approve=${review.id}`],
      ]);
      expect(await mine('u_cmember')).toEqual([]);

      const ids = [(await repo.getItem(lead, 'EHR-6')).item.id];
      const shared = await deliverables.createDeliverable(lead, 'EHR', {
        name: 'Contract signal deliverable',
        description: '',
        ownerId: lead.user.id,
        dueDate: '2026-11-30',
        visibility: 'shared',
        itemIds: ids,
        criteria: ['Works'],
      });
      await deliverables.submitDeliverable(lead, shared.id);
      expect(await kinds('u_sponsor')).toContain('deliverable_awaiting');
      expect(await kinds('u_cmember')).toEqual(['deliverable_awaiting']);
      expect(await mine('u_cviewer')).toEqual([]);
      expect(await mine('u_rsponsor')).toEqual([]);
    });

    it('risk escalations stay internal; the daily digest goes out once', async () => {
      const { raid, repo, signal } = st();
      const lead = await as('u_lead');
      await raid.createRaid(lead, {
        projectId: 'EHR',
        kind: 'risk',
        title: 'Contract signal risk',
        category: 'technical',
        probability: 5,
        impact: 5,
        visibility: 'shared',
      });
      expect(await kinds('u_lead')).toEqual(['risk_escalated']);
      expect(await mine('u_sponsor')).toEqual([]);

      await signal.setPreferences(await as('u_dev'), { mention: 'digest' });
      await repo.addComment(await as('u_team'), {
        itemId: (await item()).key,
        body: '@Adeoba digest me',
        visibility: 'internal',
      });
      const later = new Date(Date.now() + 1000);
      const first = await signal.sendDigests(later);
      expect(first.sent).toBeGreaterThanOrEqual(1);
      expect((await mine('u_dev')).find((n) => n.kind === 'mention')!.digestedAt).toBeTruthy();
      expect(await signal.sendDigests(new Date(later.getTime() + 1000))).toEqual({
        sent: 0,
        notifications: 0,
      });
    });
  });
}
