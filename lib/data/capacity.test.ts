import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import { memoryCapacityStore as capacity } from './capacity';
import { runCapacityContract } from './contract-capacity';

// Shared behaviour, also run against Postgres + RLS in capacity-postgres.test.ts.
runCapacityContract('memory', () => ({ repo: memoryRepo, capacity }), sessionFor, resetDb);

// Demo-store specifics: the audit trail lives in db().audit here (audit_log in Postgres).
describe('memory capacity — audit trail', () => {
  beforeEach(() => resetDb());
  const refused = () => db().audit.filter((a) => a.action === 'security.restricted_refused');

  it('every refused restricted-project attempt is audited', async () => {
    const lead = sessionFor('u_lead');
    await expect(
      capacity.assignMember(lead, 'RVB', {
        userId: 'u_assoc',
        projectRole: 'Integration',
        allocationPct: 50,
      }),
    ).rejects.toThrow('not a U.S. person');
    await expect(memoryRepo.updateItem(lead, 'RVB-1', { assigneeId: 'u_assoc' })).rejects.toThrow(
      'not a U.S. person',
    );
    await expect(capacity.setRestricted(lead, 'EHR', true)).rejects.toThrow('Sam Rivera');
    await expect(capacity.updatePerson(sessionFor('u_admin'), 'u_dev', { usPerson: false })).rejects.toThrow(
      'restricted projects',
    );
    expect(refused().map((a) => (a.after as { via?: string }).via ?? 'flag')).toEqual([
      'project_member',
      'assignee',
      'flag',
      'flag',
    ]);
    expect(refused()[0]).toMatchObject({ actorId: 'u_lead', entity: 'project', entityId: 'p_rvb' });
  });

  it('assignments, rate and US-flag changes are audited', async () => {
    await capacity.assignMember(sessionFor('u_lead'), 'EHR', {
      userId: 'u_team',
      projectRole: 'QA',
      allocationPct: 60,
    });
    await capacity.updatePerson(sessionFor('u_admin'), 'u_team', { costRate: 90, usPerson: false });
    expect(db().audit.map((a) => a.action)).toEqual([
      'project.member_assign',
      'profile.us_person',
      'profile.cost_rate',
    ]);
  });
});
