import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from './memory';
import { sessionFor } from '../session';
import {
  createRaid,
  escalateStaleIssues,
  listNotifications,
  listRaid,
  markNotificationsRead,
  updateRaid,
} from './raid';
import { findStaleIssues } from '../domain/raid';
import { seedRaid } from './seed-raid';

const as = (id: string) => sessionFor(id);
const DAY = 86_400_000;

describe('RAID seed', () => {
  it('has one stale Major issue on EHR, opened 14 days ago', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const { raid } = seedRaid(now);
    const stale = findStaleIssues(raid, now);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ projectId: 'p_ehr', severity: 'major', kind: 'issue' });
    expect(now.getTime() - new Date(stale[0].createdAt).getTime()).toBe(14 * DAY);
  });
  it('has an escalated 4×4 risk, exactly one shared EHR entry, every kind, and a RVB risk', () => {
    const { raid } = seedRaid();
    const ehr = raid.filter((e) => e.projectId === 'p_ehr');
    expect(ehr.some((e) => e.kind === 'risk' && e.probability === 4 && e.impact === 4)).toBe(true);
    expect(ehr.filter((e) => e.visibility === 'shared').map((e) => e.kind)).toEqual(['risk']);
    expect(new Set(ehr.map((e) => e.kind))).toEqual(
      new Set(['risk', 'assumption', 'issue', 'dependency', 'decision']),
    );
    expect(ehr.some((e) => e.kind === 'dependency' && /lab vendor/i.test(e.title))).toBe(true);
    expect(raid.some((e) => e.projectId === 'p_rvb' && e.kind === 'risk')).toBe(true);
  });
});

describe('RAID repo — visibility and permissions', () => {
  beforeEach(() => resetDb());

  it('clients see only shared entries of their own projects', async () => {
    const list = await listRaid(as('u_sponsor'), { projectId: 'EHR' });
    expect(list.map((e) => e.title)).toEqual(['Duplicate patient records delay cutover']);
    await expect(listRaid(as('u_sponsor'), { projectId: 'RVB' })).rejects.toThrow('not found');
    const all = await listRaid(as('u_sponsor'), {});
    expect(all.every((e) => e.visibility === 'shared' && e.projectId !== 'p_rvb')).toBe(true);
  });

  it('clients never learn internal work items through links', async () => {
    db()
      .raid.find((e) => e.id === 'rd_ehr_1')!
      .linkedItemIds.push('wi_ehr_12'); // internal item
    const [shared] = await listRaid(as('u_sponsor'), { projectId: 'EHR' });
    expect(shared.linkedItemIds).not.toContain('wi_ehr_12');
    expect(shared.linkedItemIds).toContain('wi_ehr_7');
  });

  it('internal users see every entry; associates only on assigned projects', async () => {
    expect((await listRaid(as('u_dev'), { projectId: 'EHR' })).length).toBe(9);
    expect((await listRaid(as('u_assoc'), { projectId: 'EHR' })).length).toBe(9);
    await expect(listRaid(as('u_assoc'), { projectId: 'RVB' })).rejects.toThrow('not found');
  });

  it('client users are read-only', async () => {
    await expect(
      createRaid(as('u_sponsor'), { projectId: 'EHR', kind: 'assumption', title: 'x' }),
    ).rejects.toThrow('cannot change');
    await expect(updateRaid(as('u_sponsor'), 'rd_ehr_1', { title: 'x' })).rejects.toThrow('cannot change');
  });

  it('associates can create and edit on their projects', async () => {
    const e = await createRaid(as('u_assoc'), {
      projectId: 'EHR',
      kind: 'dependency',
      title: 'Pharmacy vendor test account',
    });
    expect(e.visibility).toBe('internal');
    const u = await updateRaid(as('u_assoc'), e.id, { status: 'in_progress' });
    expect(u.status).toBe('in_progress');
  });

  it('lists entries linked to a work item', async () => {
    const list = await listRaid(as('u_lead'), { itemId: 'EHR-16' });
    expect(list.map((e) => e.id).sort()).toEqual(['rd_ehr_1', 'rd_ehr_6']);
    const client = await listRaid(as('u_sponsor'), { itemId: 'EHR-16' });
    expect(client.map((e) => e.id)).toEqual(['rd_ehr_1']);
  });

  it('rejects links to items in other projects', async () => {
    await expect(
      createRaid(as('u_lead'), {
        projectId: 'EHR',
        kind: 'issue',
        title: 'x',
        severity: 'minor',
        linkedItemIds: ['RVB-1'],
      }),
    ).rejects.toThrow('not in this project');
  });
});

describe('RAID repo — rules', () => {
  beforeEach(() => resetDb());

  it('a 5×4 risk escalates and notifies the lead', async () => {
    const r = await createRaid(as('u_dev'), {
      projectId: 'EHR',
      kind: 'risk',
      title: 'Go-live weekend clash',
      category: 'schedule',
      probability: 5,
      impact: 4,
    });
    expect(r).toMatchObject({ score: 20, escalate: true, band: 'red' });
    const n = await listNotifications(as('u_lead'));
    expect(n[0]).toMatchObject({ kind: 'risk_escalated', projectId: 'p_ehr', readAt: null });
    expect(n[0].href).toBe('/projects/EHR/raid?tab=risk');
  });

  it('notifies only when a risk newly crosses 15', async () => {
    await updateRaid(as('u_lead'), 'rd_ehr_1', { probability: 5 }); // 16 -> 20, already escalated
    expect(await listNotifications(as('u_lead'))).toHaveLength(0);
    await updateRaid(as('u_lead'), 'rd_ehr_2', { probability: 4 }); // 12 -> 16
    expect(await listNotifications(as('u_lead'))).toHaveLength(1);
  });

  it('requires category, probability and impact on a risk, and severity on an issue', async () => {
    await expect(createRaid(as('u_lead'), { projectId: 'EHR', kind: 'risk', title: 'x' })).rejects.toThrow(
      'category, probability and impact',
    );
    await expect(createRaid(as('u_lead'), { projectId: 'EHR', kind: 'issue', title: 'x' })).rejects.toThrow(
      'severity',
    );
  });

  it('a risk cannot be closed without a closure note, and closing is audited', async () => {
    await expect(updateRaid(as('u_lead'), 'rd_ehr_2', { status: 'closed' })).rejects.toThrow(
      'A risk cannot be closed without a closure note.',
    );
    await expect(
      updateRaid(as('u_lead'), 'rd_ehr_2', { status: 'closed', closureNote: '  ' }),
    ).rejects.toThrow('closure note');
    expect(db().raid.find((e) => e.id === 'rd_ehr_2')!.status).toBe('open');
    const closed = await updateRaid(as('u_lead'), 'rd_ehr_2', {
      status: 'closed',
      closureNote: 'Estimate re-baselined and approved.',
    });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeTruthy();
    expect(db().audit.some((a) => a.action === 'raid.close' && a.entityId === 'rd_ehr_2')).toBe(true);
  });

  it('audits visibility changes', async () => {
    await updateRaid(as('u_lead'), 'rd_ehr_3', { visibility: 'shared' });
    const a = db().audit.find((x) => x.action === 'visibility.change' && x.entityId === 'rd_ehr_3');
    expect(a).toMatchObject({ before: 'internal', after: 'shared', actorId: 'u_lead', entity: 'raid' });
    expect((await listRaid(as('u_sponsor'), { projectId: 'EHR' })).length).toBe(2);
  });

  it('computes the SLA due date at creation from severity', async () => {
    const now = new Date('2026-10-16T15:00:00Z'); // Friday
    const crit = await createRaid(
      as('u_lead'),
      { projectId: 'EHR', kind: 'issue', title: 'c', severity: 'critical' },
      now,
    );
    const major = await createRaid(
      as('u_lead'),
      { projectId: 'EHR', kind: 'issue', title: 'm', severity: 'major' },
      now,
    );
    expect(crit.slaDue).toBe('2026-10-18T15:00:00.000Z');
    expect(major.slaDue).toBe('2026-10-23T15:00:00.000Z');
  });
});

describe('RAID-02 stale issue escalation', () => {
  beforeEach(() => resetDb());

  it('notifies the lead and all admins once per 24 hours', async () => {
    const now = new Date();
    const first = await escalateStaleIssues(null, now);
    expect(first.escalated).toEqual(['rd_ehr_5']);
    expect(first.notifications.map((n) => n.userId).sort()).toEqual(['u_admin', 'u_lead']);
    expect(first.notifications.every((n) => n.kind === 'sla_breach')).toBe(true);

    const again = await escalateStaleIssues(null, new Date(now.getTime() + 23 * 3_600_000));
    expect(again.escalated).toEqual([]);
    const nextDay = await escalateStaleIssues(null, new Date(now.getTime() + 24 * 3_600_000));
    expect(nextDay.escalated).toEqual(['rd_ehr_5']);
  });

  it('an update clears staleness', async () => {
    await updateRaid(as('u_assoc'), 'rd_ehr_5', { description: 'Asked the vendor for a new extract.' });
    expect((await escalateStaleIssues(null)).escalated).toEqual([]);
  });

  it('only admins and leads may run it by hand', async () => {
    await expect(escalateStaleIssues(as('u_dev'))).rejects.toThrow('Only Admins and Delivery Leads');
    await expect(escalateStaleIssues(as('u_sponsor'))).rejects.toThrow();
    expect((await escalateStaleIssues(as('u_lead'))).escalated).toEqual(['rd_ehr_5']);
  });

  it('notifications are personal and can be marked read', async () => {
    await escalateStaleIssues(null);
    expect(await listNotifications(as('u_dev'))).toEqual([]);
    const mine = await listNotifications(as('u_admin'));
    expect(mine).toHaveLength(1);
    await markNotificationsRead(as('u_lead'), [mine[0].id]); // someone else's id: no effect
    expect((await listNotifications(as('u_admin')))[0].readAt).toBeNull();
    const after = await markNotificationsRead(as('u_admin'));
    expect(after.every((n) => n.readAt)).toBe(true);
  });
});
