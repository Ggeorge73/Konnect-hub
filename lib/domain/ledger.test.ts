import { describe, expect, it } from 'vitest';
import {
  addDays,
  approvedTimeActuals,
  canApproveTime,
  canExportTime,
  canLogTime,
  canSeeTimeCost,
  costCents,
  groupApprovals,
  hoursError,
  isEditable,
  isIsoDate,
  isoWeekLabel,
  isoWeekStart,
  mergeActuals,
  rejectReasonError,
  sumHours,
  timesheetGrid,
  weekDays,
  type TimeEntryView,
} from './ledger';
import { jsonDiff, flatten, showValue } from './audit-diff';
import { actualToDate } from './evm';
import type { Profile, Project } from './types';

const person = (id: string, role: Profile['role']): Profile => ({
  id,
  orgId: 'o',
  name: id,
  email: `${id}@x`,
  role,
  mfaEnabled: true,
  usPerson: true,
});
const project = { id: 'p', leadId: 'lead' } as Project;

const view = (over: Partial<TimeEntryView>): TimeEntryView => ({
  id: 'e',
  projectId: 'p',
  itemId: 'i1',
  userId: 'u1',
  date: '2026-10-12',
  hours: 1,
  billable: true,
  note: '',
  status: 'draft',
  submittedAt: null,
  decidedBy: null,
  decidedAt: null,
  rejectReason: null,
  createdAt: '2026-10-12T09:00:00Z',
  updatedAt: '2026-10-12T09:00:00Z',
  projectKey: 'EHR',
  itemKey: 'EHR-7',
  itemTitle: 'Dry-run',
  userName: 'Adeoba Cole',
  decidedByName: null,
  ...over,
});

describe('hours', () => {
  it('must be > 0, ≤ 24 and in quarter hours', () => {
    expect(hoursError(0.25)).toBeNull();
    expect(hoursError(2.5)).toBeNull();
    expect(hoursError(24)).toBeNull();
    expect(hoursError(7.75)).toBeNull();
    expect(hoursError(0)).toMatch('more than 0');
    expect(hoursError(-1)).toMatch('more than 0');
    expect(hoursError(Number.NaN)).toMatch('more than 0');
    expect(hoursError(24.25)).toMatch('24');
    expect(hoursError(0.3)).toMatch('quarter');
    expect(hoursError(1.1)).toMatch('quarter');
  });
  it('sums without float noise', () => {
    expect(sumHours([{ hours: 0.1 }, { hours: 0.2 }])).toBe(0.3);
    expect(sumHours([])).toBe(0);
  });
});

describe('dates and ISO weeks', () => {
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-10-12')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('12/10/2026')).toBe(false);
  });
  it('finds the Monday and the seven days of the ISO week', () => {
    expect(isoWeekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(isoWeekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(isoWeekStart('2026-10-14')).toBe('2026-10-12');
    expect(weekDays('2026-10-12')).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('labels ISO weeks, including year boundaries', () => {
    expect(isoWeekLabel('2026-10-12')).toBe('2026-W42');
    expect(isoWeekLabel('2027-01-01')).toBe('2026-W53'); // Friday of 2026's week 53
    expect(isoWeekLabel('2027-01-04')).toBe('2027-W01');
    expect(isoWeekLabel('2025-12-29')).toBe('2026-W01');
  });
});

describe('permissions', () => {
  it('lets internal users log; clients never', () => {
    for (const r of ['admin', 'delivery_lead', 'team_member', 'associate'] as const)
      expect(canLogTime(r)).toBe(true);
    for (const r of ['client_sponsor', 'client_member', 'client_viewer'] as const)
      expect(canLogTime(r)).toBe(false);
  });
  it('lets the project Lead or an Admin approve; other Leads cannot', () => {
    expect(canApproveTime(person('lead', 'delivery_lead'), project)).toBe(true);
    expect(canApproveTime(person('other', 'delivery_lead'), project)).toBe(false);
    expect(canApproveTime(person('a', 'admin'), project)).toBe(true);
    expect(canApproveTime(person('t', 'team_member'), project)).toBe(false);
  });
  it('shows cost to Admins only; Leads export hours', () => {
    expect(canSeeTimeCost(person('a', 'admin'))).toBe(true);
    expect(canSeeTimeCost(person('lead', 'delivery_lead'))).toBe(false);
    expect(canExportTime(person('lead', 'delivery_lead'))).toBe(true);
    expect(canExportTime(person('t', 'team_member'))).toBe(false);
  });
  it('locks submitted and approved entries for their owner', () => {
    expect(isEditable({ status: 'draft' })).toBe(true);
    expect(isEditable({ status: 'rejected' })).toBe(true);
    expect(isEditable({ status: 'submitted' })).toBe(false);
    expect(isEditable({ status: 'approved' })).toBe(false);
  });
  it('requires a reason to reject', () => {
    expect(rejectReasonError('rejected', ' ')).toMatch('reason');
    expect(rejectReasonError('rejected', undefined)).toMatch('reason');
    expect(rejectReasonError('rejected', 'Wrong item')).toBeNull();
    expect(rejectReasonError('approved')).toBeNull();
  });
});

describe('actual cost from approved time', () => {
  it('costs hours × rate in integer cents', () => {
    expect(costCents(2.5, 95)).toBe(23_750);
    expect(costCents(0.25, 70)).toBe(1_750);
    expect(costCents(1, 0)).toBe(0);
    expect(costCents(0.25, 33.33)).toBe(833); // 833.25 → 833
  });
  it('counts approved entries only, at the person’s rate (no rate: 0)', () => {
    const rates: Record<string, number> = { dev: 95, assoc: 70 };
    const out = approvedTimeActuals(
      [
        { status: 'approved', date: '2026-10-05', hours: 2, userId: 'dev' },
        { status: 'submitted', date: '2026-10-05', hours: 8, userId: 'dev' },
        { status: 'rejected', date: '2026-10-05', hours: 8, userId: 'dev' },
        { status: 'draft', date: '2026-10-05', hours: 8, userId: 'dev' },
        { status: 'approved', date: '2026-10-06', hours: 1, userId: 'assoc' },
        { status: 'approved', date: '2026-10-06', hours: 1, userId: 'nobody' },
      ],
      (u) => rates[u],
    );
    expect(out).toEqual([
      { date: '2026-10-05', amountCents: 19_000 },
      { date: '2026-10-06', amountCents: 7_000 },
      { date: '2026-10-06', amountCents: 0 },
    ]);
  });
  it('keeps seeded actuals only before the first approved entry (the cutover)', () => {
    const seeded = [
      { date: '2026-09-25', amountCents: 100 },
      { date: '2026-10-02', amountCents: 100 },
      { date: '2026-10-09', amountCents: 100 },
    ];
    const time = [
      { date: '2026-10-07', amountCents: 5 },
      { date: '2026-10-05', amountCents: 7 },
    ];
    const merged = mergeActuals(seeded, time);
    expect(merged.map((a) => a.date)).toEqual(['2026-09-25', '2026-10-02', '2026-10-05', '2026-10-07']);
    expect(actualToDate(merged, '2026-10-04')).toBe(200);
    expect(actualToDate(merged, '2026-10-05')).toBe(207);
    expect(actualToDate(merged, '2026-10-31')).toBe(212); // the seeded 9 Oct entry is replaced
    expect(mergeActuals(seeded, [])).toEqual(seeded);
    expect(mergeActuals([], time).map((a) => a.amountCents)).toEqual([7, 5]);
  });
});

describe('timesheet grid', () => {
  it('builds item × day rows with row, day and week totals', () => {
    const g = timesheetGrid(
      [
        view({ id: 'a', date: '2026-10-12', hours: 2.5 }),
        view({ id: 'b', date: '2026-10-12', hours: 1 }),
        view({ id: 'c', date: '2026-10-14', hours: 4, itemId: 'i2', itemKey: 'EHR-12', itemTitle: 'Vendor' }),
        view({ id: 'd', date: '2026-10-19', hours: 8 }), // next week: ignored
      ],
      '2026-10-12',
      [{ projectKey: 'EHR', itemId: 'i3', itemKey: 'EHR-10', itemTitle: 'Empty row' }],
    );
    expect(g.days).toHaveLength(7);
    expect(g.rows.map((r) => r.itemKey)).toEqual(['EHR-7', 'EHR-10', 'EHR-12']);
    expect(g.rows[0].cells[0]).toMatchObject({ date: '2026-10-12', hours: 3.5 });
    expect(g.rows[0].cells[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(g.rows[0].total).toBe(3.5);
    expect(g.rows[1].total).toBe(0);
    expect(g.dayTotals).toEqual([3.5, 0, 4, 0, 0, 0, 0]);
    expect(g.total).toBe(7.5);
  });
});

describe('approval groups', () => {
  it('groups by person and ISO week, newest week first, then by name', () => {
    const groups = groupApprovals([
      view({ id: '1', userId: 'dev', userName: 'Adeoba Cole', date: '2026-10-06', hours: 2 }),
      view({ id: '2', userId: 'dev', userName: 'Adeoba Cole', date: '2026-10-13', hours: 2.5 }),
      view({ id: '3', userId: 'dev', userName: 'Adeoba Cole', date: '2026-10-12', hours: 1 }),
      view({ id: '4', userId: 'qa', userName: 'Tiara Mensah', date: '2026-10-14', hours: 3 }),
      view({ id: '5', userId: 'as', userName: 'Sam Rivera', date: '2026-10-18', hours: 1 }),
    ]);
    expect(groups.map((g) => [g.userName, g.week, g.hours])).toEqual([
      ['Adeoba Cole', '2026-W42', 3.5],
      ['Sam Rivera', '2026-W42', 1],
      ['Tiara Mensah', '2026-W42', 3],
      ['Adeoba Cole', '2026-W41', 2],
    ]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(['3', '2']);
    expect(groups[0].weekStart).toBe('2026-10-12');
  });
});

describe('audit before/after diff', () => {
  it('reports added, removed, changed and unchanged paths', () => {
    expect(
      jsonDiff(
        { rag: 'amber', ragReason: 'x', nested: { a: 1, b: 2 } },
        { rag: 'red', nested: { a: 1, c: 3 } },
      ),
    ).toEqual([
      { path: 'nested.a', kind: 'same', before: 1, after: 1 },
      { path: 'nested.b', kind: 'removed', before: 2 },
      { path: 'nested.c', kind: 'added', after: 3 },
      { path: 'rag', kind: 'changed', before: 'amber', after: 'red' },
      { path: 'ragReason', kind: 'removed', before: 'x' },
    ]);
  });
  it('handles scalars, arrays and missing sides', () => {
    expect(jsonDiff('internal', 'shared')).toEqual([
      { path: '(value)', kind: 'changed', before: 'internal', after: 'shared' },
    ]);
    expect(jsonDiff(undefined, { rows: 3 })).toEqual([{ path: 'rows', kind: 'added', after: 3 }]);
    expect(jsonDiff({ l: [1, 2] }, { l: [1, 2] })[0].kind).toBe('same');
    expect(jsonDiff(undefined, undefined)).toEqual([]);
    expect([...flatten({ a: {} })]).toEqual([['a', {}]]);
    expect(showValue('x')).toBe('x');
    expect(showValue({ a: 1 })).toBe('{"a":1}');
    expect(showValue(undefined)).toBe('');
  });
});
