import { describe, expect, it } from 'vitest';
import type { Session } from '../domain/types';
import {
  useStores,
  type DomainStores,
  type MakeStores,
  type Reset,
  type SessionFor,
} from './contract-support';

/** Sprint planning and timeline rules every SprintStore must share (demo store and Postgres + RLS). */
export function runSprintContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} sprints contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    /** The seeded EHR sprints: Sprint 2 is active and Sprint 3 planned in both stores. */
    async function ehrSprints({ sprints }: DomainStores, s: Session) {
      const list = await sprints.listSprints(s, 'EHR');
      const byName = (n: string) => list.sprints.find((x) => x.name === n)!;
      return { list, s2: byName('EHR Sprint 2'), s3: byName('EHR Sprint 3') };
    }
    const phase = async ({ repo }: DomainStores, s: Session, key: string, gate: number) =>
      (await repo.getProjectBundle(s, key)).phases.find((p) => p.gate === gate)!.id;

    it('only the project Lead or an Admin plans sprints, with valid dates and phase', async () => {
      const lead = await as('u_lead');
      const { sprints } = st();
      const input = {
        projectId: 'EHR',
        name: 'EHR Sprint 4',
        phaseId: await phase(st(), lead, 'EHR', 3),
        startDate: '2026-11-02',
        endDate: '2026-11-13',
        capacityHours: 200,
      };
      await expect(sprints.createSprint(await as('u_dev'), input)).rejects.toThrow(
        /Delivery Lead or an Admin/,
      );
      await expect(sprints.createSprint(await as('u_sponsor'), input)).rejects.toThrow();
      expect((await sprints.createSprint(await as('u_admin'), input)).status).toBe('planned');
      const s4 = await sprints.createSprint(lead, { ...input, name: '  EHR Sprint 5 ' });
      expect(s4).toMatchObject({ name: 'EHR Sprint 5', status: 'planned', capacityHours: 200 });

      await expect(sprints.createSprint(lead, { ...input, endDate: input.startDate })).rejects.toThrow(
        /after the start/,
      );
      const rvbPhase = await phase(st(), await as('u_admin'), 'RVB', 2);
      await expect(sprints.createSprint(lead, { ...input, phaseId: rvbPhase })).rejects.toThrow(
        /phase of this project/,
      );

      const client = await sprints.listSprints(await as('u_sponsor'), 'EHR');
      expect(client.canManage).toBe(false);
      expect(client.sprints.some((x) => x.id === s4.id)).toBe(true);
      expect((await sprints.listSprints(lead, 'EHR')).canManage).toBe(true);
      await expect(sprints.listSprints(await as('u_rsponsor'), 'EHR')).rejects.toThrow('not found');
      await expect(sprints.updateSprint(await as('u_dev'), s4.id, { name: 'x' })).rejects.toThrow(
        /Delivery Lead or an Admin/,
      );
      await expect(sprints.updateSprint(lead, s4.id, { endDate: '2026-11-01' })).rejects.toThrow(
        /after the start/,
      );
      expect((await sprints.updateSprint(lead, s4.id, { goal: 'Train super-users' })).goal).toBe(
        'Train super-users',
      );
    });

    it('a project runs only one active sprint at a time', async () => {
      const lead = await as('u_lead');
      const { sprints } = st();
      const { s2, s3 } = await ehrSprints(st(), lead);
      expect(s2.status).toBe('active');
      expect(s3.status).toBe('planned');
      await expect(sprints.startSprint(lead, s3.id)).rejects.toThrow(/EHR Sprint 2 is still active/);
      await expect(sprints.startSprint(lead, s2.id)).rejects.toThrow(/already active/);
      await expect(sprints.startSprint(await as('u_dev'), s3.id)).rejects.toThrow(
        /Delivery Lead or an Admin/,
      );

      await sprints.completeSprint(lead, s2.id, 'backlog');
      expect((await sprints.startSprint(lead, s3.id)).status).toBe('active');
      const s4 = await sprints.createSprint(lead, {
        projectId: 'EHR',
        name: 'EHR Sprint 4',
        phaseId: s3.phaseId,
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      });
      await expect(sprints.startSprint(lead, s4.id)).rejects.toThrow(/EHR Sprint 3 is still active/);
      await expect(sprints.startSprint(lead, s2.id)).rejects.toThrow(/completed/);
      const all = (await sprints.listSprints(lead, 'EHR')).sprints;
      expect(all.filter((x) => x.status === 'active').map((x) => x.id)).toEqual([s3.id]);
    });

    it('completing a sprint carries unfinished work over to the next planned sprint', async () => {
      const lead = await as('u_lead');
      const dev = await as('u_dev');
      const { sprints, repo } = st();
      const { s2, s3 } = await ehrSprints(st(), lead);
      const open = await repo.createItem(dev, {
        projectId: 'EHR',
        type: 'task',
        title: 'Carry me',
        sprintId: s2.id,
      });
      const done = await repo.createItem(dev, {
        projectId: 'EHR',
        type: 'task',
        title: 'Finished in sprint',
        sprintId: s2.id,
        status: 'done',
      });

      await expect(sprints.completeSprint(dev, s2.id, 'next')).rejects.toThrow(/Delivery Lead or an Admin/);
      const r = await sprints.completeSprint(lead, s2.id, 'next');
      expect(r.sprint.status).toBe('completed');
      expect(r.targetSprintId).toBe(s3.id);
      expect(r.moved).toContain(open.key);
      expect(r.moved).not.toContain(done.key);
      expect((await repo.getItem(dev, open.key)).item.sprintId).toBe(s3.id);
      expect((await repo.getItem(dev, done.key)).item.sprintId).toBe(s2.id);
      await expect(sprints.completeSprint(lead, s2.id, 'next')).rejects.toThrow(/Only an active sprint/);
      const activity = await repo.listActivity(lead, 'EHR', 50);
      expect(activity.some((a) => a.action === 'sprint.completed' && a.detail.includes('EHR Sprint 3'))).toBe(
        true,
      );
    });

    it('completing can send unfinished work to the backlog, and must when no sprint is planned', async () => {
      const lead = await as('u_lead');
      const admin = await as('u_admin');
      const { sprints, repo } = st();
      const { s2 } = await ehrSprints(st(), lead);
      const open = await repo.createItem(lead, {
        projectId: 'EHR',
        type: 'bug',
        title: 'Back to backlog',
        sprintId: s2.id,
      });
      const r = await sprints.completeSprint(lead, s2.id, 'backlog');
      expect(r.targetSprintId).toBeNull();
      expect(r.moved).toContain(open.key);
      expect((await repo.getItem(lead, open.key)).item.sprintId).toBeNull();

      // PSR has no sprints: its first sprint, once active, has nothing planned after it.
      const only = await sprints.createSprint(admin, {
        projectId: 'PSR',
        name: 'PSR Sprint 1',
        phaseId: await phase(st(), admin, 'PSR', 3),
        startDate: '2026-11-02',
        endDate: '2026-11-13',
      });
      await sprints.startSprint(admin, only.id);
      const item = await repo.createItem(admin, {
        projectId: 'PSR',
        type: 'task',
        title: 'Unfinished',
        sprintId: only.id,
      });
      await expect(sprints.completeSprint(admin, only.id, 'next')).rejects.toThrow(/no planned sprint/);
      expect((await sprints.completeSprint(admin, only.id, 'backlog')).moved).toContain(item.key);
    });

    it('capacity settings and the timeline are per project and manager-only', async () => {
      const lead = await as('u_lead');
      const sponsor = await as('u_sponsor');
      const { sprints, repo } = st();
      await expect(sprints.setHoursPerPoint(await as('u_dev'), 'EHR', 8)).rejects.toThrow();
      await expect(sprints.setHoursPerPoint(lead, 'EHR', 0)).rejects.toThrow(/between 0 and 100/);
      expect(await sprints.setHoursPerPoint(lead, 'EHR', 8)).toMatchObject({ hoursPerPoint: 8 });
      expect((await sprints.listSprints(sponsor, 'EHR')).hoursPerPoint).toBe(8);
      expect((await sprints.listSprints(lead, 'RVB')).hoursPerPoint).toBe(6);

      const internal = await sprints.getTimeline(lead, 'EHR');
      const client = await sprints.getTimeline(sponsor, 'EHR');
      expect(internal.canEdit).toBe(true);
      expect(client.canEdit).toBe(false);
      expect(internal.items.some((i) => i.key === 'EHR-12')).toBe(true);
      expect(client.items.some((i) => i.key === 'EHR-12' || i.key === 'EHR-3')).toBe(false);
      const visible = new Set(client.items.map((i) => i.id));
      expect(client.links.every((l) => visible.has(l.fromId) && visible.has(l.toId))).toBe(true);
      expect(internal.phases.map((p) => p.gate)).toEqual([1, 2, 3, 4, 5]);

      const epic = (await repo.getItem(lead, 'EHR-1')).item.id;
      const move = { kind: 'epic' as const, id: epic, startDate: '2026-09-02', endDate: '2026-11-02' };
      await expect(sprints.reschedule(await as('u_dev'), 'EHR', move)).rejects.toThrow();
      await sprints.reschedule(lead, 'EHR', { ...move, startDate: '2026-09-01' });
      await sprints.reschedule(lead, 'EHR', move);
      const schedules = (await sprints.getTimeline(sponsor, 'EHR')).schedules;
      expect(schedules.filter((x) => x.itemId === epic)).toEqual([
        { itemId: epic, projectId: internal.project.id, startDate: '2026-09-02', endDate: '2026-11-02' },
      ]);
      const story = (await repo.getItem(lead, 'EHR-7')).item.id;
      await expect(sprints.reschedule(lead, 'EHR', { ...move, id: story })).rejects.toThrow(/Epic not found/);

      const { s3 } = await ehrSprints(st(), lead);
      await sprints.reschedule(lead, 'EHR', {
        kind: 'sprint',
        id: s3.id,
        startDate: '2026-10-20',
        endDate: '2026-10-31',
      });
      expect((await ehrSprints(st(), lead)).s3).toMatchObject({
        startDate: '2026-10-20',
        endDate: '2026-10-31',
      });
    });
  });
}
