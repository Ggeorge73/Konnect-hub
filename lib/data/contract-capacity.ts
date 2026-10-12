import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { CapacityStore } from './capacity';
import type { Persona } from './contract';
import type { Session } from '../domain/types';
import { addWeeks, nextWeeks } from '../domain/capacity';

export interface CapacityStores {
  repo: Repo;
  capacity: CapacityStore;
}

/**
 * KH-34/35/36 rules every CapacityStore must share (demo store and Postgres + RLS). Scenarios use
 * project and item keys and the ids the stores return, never store-specific ids.
 */
export function runCapacityContract(
  name: string,
  make: () => CapacityStores,
  sessionFor: (p: Persona) => Session | Promise<Session>,
  reset: () => void | Promise<void>,
) {
  describe(`${name} capacity contract`, () => {
    let st: CapacityStores;
    const as = (p: Persona) => Promise.resolve(sessionFor(p));
    const idOf = async (p: Persona) => (await as(p)).user.id;
    beforeEach(async () => {
      await reset();
      st = make();
    });

    it('the directory shows each role only what it may see; clients are refused', async () => {
      const { capacity } = st;
      const byName = (list: Awaited<ReturnType<CapacityStore['listDirectory']>>, n: string) =>
        list.find((p) => p.name === n)!;

      const assoc = await capacity.listDirectory(await as('u_assoc'));
      expect(assoc.map((p) => p.name)).toContain('Tiara Mensah');
      expect(assoc.some((p) => p.name === 'Grace Whitfield')).toBe(false);
      for (const p of assoc) {
        expect(Object.keys(p).sort()).toEqual(['id', 'name', 'skills']);
      }

      const team = byName(await capacity.listDirectory(await as('u_team')), 'Sam Rivera');
      expect(team.usPerson).toBeUndefined();
      expect(team.costRate).toBeUndefined();
      expect(team.allocationPct).toBe(100);
      expect(team.certifications).toEqual(['HL7 FHIR R4']);
      expect(team.location).toBe('London, UK');

      const lead = byName(await capacity.listDirectory(await as('u_lead')), 'Sam Rivera');
      expect(lead.usPerson).toBe(false);
      expect(lead.costRate).toBeUndefined();

      const admin = byName(await capacity.listDirectory(await as('u_admin')), 'Sam Rivera');
      expect(admin.costRate).toBe(70);
      expect(admin.hoursPerWeek).toBe(30);

      await expect(capacity.listDirectory(await as('u_sponsor'))).rejects.toThrow('Konnector staff');
      await expect(capacity.getPerson(await as('u_cviewer'), await idOf('u_team'))).rejects.toThrow(
        'Konnector staff',
      );

      const detail = await capacity.getPerson(await as('u_lead'), await idOf('u_team'));
      expect(detail.memberships?.map((m) => m.projectKey)).toEqual(['EHR']);
      const adminDetail = await capacity.getPerson(await as('u_admin'), await idOf('u_team'));
      expect(adminDetail.memberships?.map((m) => m.projectKey)).toEqual(['EHR', 'PSR']);
      expect(
        (await capacity.getPerson(await as('u_assoc'), await idOf('u_team'))).memberships,
      ).toBeUndefined();
    });

    it('Leads edit skills and certifications; Admins edit everything; others nothing', async () => {
      const { capacity } = st;
      const team = await idOf('u_team');
      const lead = await as('u_lead');
      const e = await capacity.updatePerson(lead, team, {
        skills: ['QA', ' Accessibility ', 'QA'],
        certifications: ['ISTQB Advanced'],
      });
      expect(e.skills).toEqual(['QA', 'Accessibility']);
      expect(e.certifications).toEqual(['ISTQB Advanced']);
      await expect(capacity.updatePerson(lead, team, { usPerson: false })).rejects.toThrow(
        'skills and certifications',
      );
      await expect(capacity.updatePerson(lead, team, { costRate: 1 })).rejects.toThrow(
        'skills and certifications',
      );
      await expect(capacity.updatePerson(await as('u_dev'), team, { skills: ['x'] })).rejects.toThrow(
        'Only Admins and Delivery Leads',
      );

      const admin = await as('u_admin');
      const a = await capacity.updatePerson(admin, team, {
        title: 'Senior QA Engineer',
        hoursPerWeek: 32,
        costRate: 88,
        location: 'Remote',
      });
      expect(a).toMatchObject({
        title: 'Senior QA Engineer',
        hoursPerWeek: 32,
        costRate: 88,
        location: 'Remote',
      });
      // The rate never reaches a Lead.
      const seen = (await capacity.listDirectory(lead)).find((p) => p.id === team)!;
      expect(seen.costRate).toBeUndefined();
      expect(seen.title).toBe('Senior QA Engineer');
    });

    it('an Admin cannot clear the U.S.-person flag of someone on a restricted project', async () => {
      const { capacity } = st;
      const admin = await as('u_admin');
      await expect(capacity.updatePerson(admin, await idOf('u_dev'), { usPerson: false })).rejects.toThrow(
        'Adeoba Cole is on restricted projects (RVB); remove them first.',
      );
      const t = await capacity.updatePerson(admin, await idOf('u_team'), { usPerson: false });
      expect(t.usPerson).toBe(false);
    });

    it('the grid shows 12 ISO weeks, stacked project hours, hidden projects as other hours, and load', async () => {
      const { capacity } = st;
      const weeks = nextWeeks(new Date());
      const lead = await as('u_lead');
      const grid = await capacity.getGrid(lead);
      expect(grid.weeks).toEqual(weeks);
      expect(grid.projects.map((p) => p.key)).toEqual(['EHR', 'RVB']);
      expect(grid.projects.every((p) => p.editable)).toBe(true);

      const dev = grid.rows.find((r) => r.person.name === 'Adeoba Cole')!;
      const spike = dev.cells.find((c) => c.week === addWeeks(weeks[0], 2))!;
      expect(spike.projects.map((p) => [p.projectKey, p.hours])).toEqual([
        ['EHR', 40],
        ['RVB', 8],
      ]);
      expect(spike).toMatchObject({ hours: 48, pct: 120, level: 'red' });
      expect(dev.cells[0]).toMatchObject({ hours: 40, pct: 100, level: 'amber' });

      // PSR is not visible to the Lead: Tiara's PSR hours count, without the project.
      const tiara = grid.rows.find((r) => r.person.name === 'Tiara Mensah')!;
      expect(tiara.cells[0].projects.map((p) => p.projectKey)).toEqual(['EHR']);
      expect(tiara.cells[0]).toMatchObject({ otherHours: 12, hours: 32, pct: 80, level: 'ok' });
      expect(tiara.person.memberOf).toHaveLength(1);

      const admin = await capacity.getGrid(await as('u_admin'));
      const t = admin.rows.find((r) => r.person.name === 'Tiara Mensah')!;
      expect(t.cells[0].otherHours).toBe(0);
      expect(t.cells[0].projects.map((p) => p.projectKey)).toEqual(['EHR', 'PSR']);

      const team = await capacity.getGrid(await as('u_team'));
      expect(team.projects.every((p) => !p.editable)).toBe(true);
      await expect(capacity.getGrid(await as('u_assoc'))).rejects.toThrow('allocation grid');
      await expect(capacity.getGrid(await as('u_sponsor'))).rejects.toThrow('allocation grid');
    });

    it('managers edit hours inline; others cannot', async () => {
      const { capacity } = st;
      const week = nextWeeks(new Date())[1];
      const ehr = (await st.repo.getProjectBundle(await as('u_lead'), 'EHR')).project.id;
      const team = await idOf('u_team');
      const lead = await as('u_lead');
      expect(await capacity.setAllocation(lead, { projectId: ehr, userId: team, week, hours: 36 })).toEqual({
        hours: 36,
      });
      const row = (await capacity.getGrid(lead)).rows.find((r) => r.person.id === team)!;
      expect(row.cells[1]).toMatchObject({ hours: 48, pct: 120, level: 'red' });
      await capacity.setAllocation(lead, { projectId: 'EHR', userId: team, week, hours: 0 });
      const after = (await capacity.getGrid(lead)).rows.find((r) => r.person.id === team)!;
      expect(after.cells[1].projects).toEqual([]);

      const tuesday = new Date(Date.parse(`${week}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      await expect(
        capacity.setAllocation(lead, { projectId: 'EHR', userId: team, week: tuesday, hours: 1 }),
      ).rejects.toThrow('Monday');
      await expect(
        capacity.setAllocation(await as('u_team'), { projectId: 'EHR', userId: team, week, hours: 1 }),
      ).rejects.toThrow('Delivery Lead');
      await expect(
        capacity.setAllocation(lead, { projectId: 'PSR', userId: team, week, hours: 1 }),
      ).rejects.toThrow('not found');
    });

    it('assigning warns above 80% / 100% but does not block, and seeds weekly hours', async () => {
      const { capacity } = st;
      const lead = await as('u_lead');
      const team = await idOf('u_team');
      const p = await capacity.previewAssignment(lead, 'EHR', { userId: team, allocationPct: 60 });
      expect(p.refusal).toBeNull();
      expect(p.warnings).toHaveLength(12);
      expect(p.warnings.every((w) => w.level === 'amber' && w.pct === 90)).toBe(true);
      expect(p.summary).toMatch(
        /^Tiara Mensah would be above 80% of capacity in 12 weeks \(peak 90% in W\d\d\)\.$/,
      );

      const r = await capacity.assignMember(lead, 'EHR', {
        userId: team,
        projectRole: 'QA Lead',
        allocationPct: 60,
      });
      expect(r.warnings).toHaveLength(12);
      const t = await capacity.getTeam(lead, 'EHR');
      expect(t.members.find((m) => m.userId === team)).toMatchObject({
        projectRole: 'QA Lead',
        allocationPct: 60,
      });
      const row = (await capacity.getGrid(lead)).rows.find((x) => x.person.id === team)!;
      expect(row.cells[0]).toMatchObject({ hours: 36, pct: 90, level: 'amber' });
      expect(row.cells[0].projects).toEqual([expect.objectContaining({ projectKey: 'EHR', hours: 24 })]);

      const over = await capacity.previewAssignment(lead, 'EHR', { userId: team, allocationPct: 100 });
      expect(over.summary).toContain('over 100% of capacity in 12 weeks');

      // A new member on RVB gets hours only inside the project window.
      await capacity.assignMember(lead, 'RVB', { userId: team, projectRole: 'QA', allocationPct: 10 });
      expect((await capacity.getTeam(lead, 'RVB')).members.map((m) => m.name)).toContain('Tiara Mensah');
      await capacity.removeMember(lead, 'RVB', team);
      expect((await capacity.getTeam(lead, 'RVB')).members.map((m) => m.name)).not.toContain('Tiara Mensah');

      await expect(
        capacity.assignMember(await as('u_dev'), 'EHR', {
          userId: team,
          projectRole: 'QA',
          allocationPct: 10,
        }),
      ).rejects.toThrow('Delivery Lead');
      await expect(
        capacity.assignMember(lead, 'EHR', {
          userId: await idOf('u_sponsor'),
          projectRole: 'QA',
          allocationPct: 10,
        }),
      ).rejects.toThrow('Unknown person');
    });

    it('a non-U.S. person is refused on a restricted project: member, allocation and assignee', async () => {
      const { capacity, repo } = st;
      const lead = await as('u_lead');
      const assoc = await idOf('u_assoc');
      const msg = 'Sam Rivera is not a U.S. person and cannot be assigned to restricted project RVB.';
      expect(
        (await capacity.previewAssignment(lead, 'RVB', { userId: assoc, allocationPct: 50 })).refusal,
      ).toBe(msg);
      await expect(
        capacity.assignMember(lead, 'RVB', { userId: assoc, projectRole: 'Integration', allocationPct: 50 }),
      ).rejects.toThrow(msg);
      expect((await capacity.getTeam(lead, 'RVB')).members.some((m) => m.userId === assoc)).toBe(false);
      await expect(
        capacity.setAllocation(lead, {
          projectId: 'RVB',
          userId: assoc,
          week: nextWeeks(new Date())[0],
          hours: 8,
        }),
      ).rejects.toThrow(msg);
      await expect(repo.updateItem(lead, 'RVB-2', { assigneeId: assoc })).rejects.toThrow(msg);
      const rvb = (await repo.getProjectBundle(lead, 'RVB')).project.id;
      await expect(
        repo.createItem(lead, {
          projectId: rvb,
          type: 'task',
          title: 'Export-controlled task',
          assigneeId: assoc,
        }),
      ).rejects.toThrow(msg);
      expect((await repo.getItem(lead, 'RVB-2')).item.assigneeId).not.toBe(assoc);
      // U.S. persons are fine; non-restricted projects are fine.
      await repo.updateItem(lead, 'RVB-2', { assigneeId: await idOf('u_team') });
      await repo.updateItem(lead, 'EHR-12', { assigneeId: assoc });
    });

    it('a project cannot be flipped to restricted while non-U.S. people are on it', async () => {
      const { capacity } = st;
      const lead = await as('u_lead');
      await expect(capacity.setRestricted(lead, 'EHR', true)).rejects.toThrow(
        'Cannot mark EHR restricted: remove these non-U.S. people first: Sam Rivera.',
      );
      expect((await capacity.getTeam(lead, 'EHR')).project.restricted).toBe(false);
      const admin = await as('u_admin');
      expect(await capacity.setRestricted(admin, 'PSR', true)).toEqual({ restricted: true });
      expect((await capacity.getTeam(admin, 'PSR')).project.restricted).toBe(true);
      expect(await capacity.setRestricted(admin, 'PSR', false)).toEqual({ restricted: false });
      await expect(capacity.setRestricted(await as('u_dev'), 'EHR', true)).rejects.toThrow('Delivery Lead');
    });
  });
}
