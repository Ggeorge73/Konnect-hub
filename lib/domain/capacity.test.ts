import { describe, expect, it } from 'vitest';
import {
  addWeeks,
  assignmentWarnings,
  buildGrid,
  capacityOf,
  cellLoad,
  cleanTags,
  defaultAllocations,
  directoryEntry,
  editableFields,
  filterDirectory,
  forbiddenField,
  hoursForPct,
  isMonday,
  isoWeekNumber,
  isoWeekStart,
  loadLevel,
  loadPct,
  nextWeeks,
  nonUsPeopleOn,
  restrictedRefusal,
  restrictFlipRefusal,
  usFlagRefusal,
  warningSummary,
  weekLabel,
  canViewDirectory,
  canViewGrid,
} from './capacity';
import type { Profile } from './types';

const person = (over: Partial<Profile> = {}): Profile => ({
  id: 'u_x',
  orgId: 'org_konnector',
  name: 'Pat Doe',
  email: 'pat@konnectortech.com',
  role: 'team_member',
  mfaEnabled: true,
  usPerson: true,
  title: 'Engineer',
  skills: ['TypeScript'],
  timezone: 'America/New_York',
  hoursPerWeek: 40,
  costRate: 99,
  ...over,
});

describe('ISO weeks', () => {
  it('finds the Monday of the week, including across Sunday and year ends', () => {
    expect(isoWeekStart('2026-10-12')).toBe('2026-10-12');
    expect(isoWeekStart('2026-10-18')).toBe('2026-10-12');
    expect(isoWeekStart(new Date('2026-10-14T23:30:00Z'))).toBe('2026-10-12');
    expect(isoWeekStart('2027-01-01')).toBe('2026-12-28');
  });

  it('lists 12 consecutive weeks from the current one', () => {
    const w = nextWeeks(new Date('2026-10-14T10:00:00Z'));
    expect(w).toHaveLength(12);
    expect(w[0]).toBe('2026-10-12');
    expect(w[11]).toBe('2026-12-28');
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
  });

  it('numbers ISO weeks', () => {
    expect(isoWeekNumber('2026-10-12')).toEqual({ year: 2026, week: 42 });
    expect(isoWeekNumber('2026-12-28')).toEqual({ year: 2026, week: 53 });
    expect(isoWeekNumber('2027-01-04')).toEqual({ year: 2027, week: 1 });
    expect(weekLabel('2027-01-04')).toBe('W01');
  });

  it('validates Mondays', () => {
    expect(isMonday('2026-10-12')).toBe(true);
    expect(isMonday('2026-10-13')).toBe(false);
    expect(isMonday('12/10/2026')).toBe(false);
  });
});

describe('load thresholds', () => {
  it('is amber above 80% and red above 100%', () => {
    expect(loadLevel(80)).toBe('ok');
    expect(loadLevel(81)).toBe('amber');
    expect(loadLevel(100)).toBe('amber');
    expect(loadLevel(101)).toBe('red');
  });

  it('computes % of capacity and the cell load', () => {
    expect(loadPct(0, 0)).toBe(0);
    expect(loadPct(10, 0)).toBe(999);
    expect(loadPct(36, 40)).toBe(90);
    expect(cellLoad(48, 40)).toEqual({ hours: 48, pct: 120, level: 'red' });
    expect(cellLoad(32, 40)).toEqual({ hours: 32, pct: 80, level: 'ok' });
  });

  it('defaults capacity to 40 hours', () => {
    expect(capacityOf({})).toBe(40);
    expect(capacityOf({ hoursPerWeek: 0 })).toBe(40);
    expect(capacityOf({ hoursPerWeek: 30 })).toBe(30);
    expect(hoursForPct(30, 33)).toBe(9.9);
  });
});

describe('staffing', () => {
  const weeks = nextWeeks(new Date('2026-10-12T00:00:00Z'));

  it('seeds capacity × pct across the project window, capped to the view', () => {
    const all = defaultAllocations(40, 60, { startDate: '2026-08-03', targetDate: '2027-06-30' }, weeks);
    expect(all).toHaveLength(12);
    expect(all[0]).toEqual({ week: '2026-10-12', hours: 24 });
    const window = defaultAllocations(40, 50, { startDate: '2026-10-21', targetDate: '2026-11-04' }, weeks);
    expect(window.map((a) => a.week)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    expect(defaultAllocations(40, 0, {}, weeks)).toEqual([]);
  });

  it('warns for the weeks that go above 80% or 100%', () => {
    const w = assignmentWarnings(40, [
      { week: weeks[0], otherHours: 12, newHours: 24 },
      { week: weeks[1], otherHours: 0, newHours: 24 },
      { week: weeks[2], otherHours: 20, newHours: 24 },
    ]);
    expect(w).toEqual([
      { week: weeks[0], hours: 36, pct: 90, level: 'amber' },
      { week: weeks[2], hours: 44, pct: 110, level: 'red' },
    ]);
    expect(warningSummary('Tiara Mensah', w)).toBe(
      'Tiara Mensah would be over 100% of capacity in 1 week (peak 110% in W44).',
    );
    expect(warningSummary('Tiara Mensah', w.slice(0, 1))).toBe(
      'Tiara Mensah would be above 80% of capacity in 1 week (peak 90% in W42).',
    );
    expect(warningSummary('x', [])).toBeNull();
  });
});

describe('restricted projects (SEC-02)', () => {
  const rvb = { key: 'RVB', restricted: true };
  it('refuses non-U.S. people on restricted projects only', () => {
    expect(restrictedRefusal(rvb, { name: 'Sam Rivera', usPerson: false })).toBe(
      'Sam Rivera is not a U.S. person and cannot be assigned to restricted project RVB.',
    );
    expect(restrictedRefusal(rvb, { name: 'Ada', usPerson: true })).toBeNull();
    expect(restrictedRefusal({ key: 'EHR', restricted: false }, { name: 'Sam', usPerson: false })).toBeNull();
    expect(restrictedRefusal(rvb, undefined)).toBeNull();
  });

  it('lists the non-U.S. people to remove before flipping to restricted', () => {
    const people = [
      { id: 'a', name: 'Sam Rivera', usPerson: false },
      { id: 'b', name: 'Ada', usPerson: true },
      { id: 'c', name: 'Bo Li', usPerson: false },
      { id: 'd', name: 'Cy', usPerson: false },
    ];
    const names = nonUsPeopleOn('p1', people, {
      members: [
        { projectId: 'p1', userId: 'a' },
        { projectId: 'p1', userId: 'b' },
        { projectId: 'p2', userId: 'd' },
      ],
      assigneeIds: ['c'],
      allocationUserIds: [],
    });
    expect(names).toEqual(['Sam Rivera', 'Bo Li']);
    expect(restrictFlipRefusal('EHR', names)).toBe(
      'Cannot mark EHR restricted: remove these non-U.S. people first: Bo Li, Sam Rivera.',
    );
    expect(restrictFlipRefusal('EHR', [])).toBeNull();
    expect(usFlagRefusal('Adeoba Cole', ['RVB'])).toBe(
      'Adeoba Cole is on restricted projects (RVB); remove them first.',
    );
    expect(usFlagRefusal('x', [])).toBeNull();
  });
});

describe('directory permissions (PPL-01)', () => {
  const p = person({ usPerson: false });
  const extras = { certifications: ['CSM'], location: 'London' };

  it('associates get names and skills only', () => {
    expect(directoryEntry({ role: 'associate' }, p, extras, 75)).toEqual({
      id: 'u_x',
      name: 'Pat Doe',
      skills: ['TypeScript'],
    });
  });

  it('team members see details but not the US flag or rate', () => {
    const e = directoryEntry({ role: 'team_member' }, p, extras, 75);
    expect(e).toMatchObject({
      certifications: ['CSM'],
      location: 'London',
      allocationPct: 75,
      hoursPerWeek: 40,
    });
    expect('usPerson' in e).toBe(false);
    expect('costRate' in e).toBe(false);
  });

  it('leads see the US flag; only admins see the rate', () => {
    const lead = directoryEntry({ role: 'delivery_lead' }, p, extras, 75);
    expect(lead.usPerson).toBe(false);
    expect('costRate' in lead).toBe(false);
    expect(directoryEntry({ role: 'admin' }, p, extras, 75).costRate).toBe(99);
  });

  it('clients are kept out; the grid is for admins, leads and team members', () => {
    expect(canViewDirectory({ role: 'client_sponsor' })).toBe(false);
    expect(canViewDirectory({ role: 'associate' })).toBe(true);
    expect(canViewGrid({ role: 'associate' })).toBe(false);
    expect(canViewGrid({ role: 'team_member' })).toBe(true);
  });

  it('admins edit every field, leads skills and certifications, others nothing', () => {
    expect(editableFields({ role: 'admin' })).toContain('costRate');
    expect(editableFields({ role: 'delivery_lead' })).toEqual(['skills', 'certifications']);
    expect(editableFields({ role: 'team_member' })).toEqual([]);
    expect(forbiddenField({ role: 'delivery_lead' }, { skills: ['x'] })).toBeNull();
    expect(forbiddenField({ role: 'delivery_lead' }, { skills: ['x'], usPerson: true })).toBe('usPerson');
    expect(forbiddenField({ role: 'admin' }, { usPerson: true, costRate: 1 })).toBeNull();
  });

  it('searches and filters by skill and role', () => {
    const list = [
      directoryEntry(
        { role: 'admin' },
        person({ id: 'a', name: 'Ada', skills: ['PMP'], role: 'admin' }),
        undefined,
        0,
      ),
      directoryEntry({ role: 'admin' }, person({ id: 'b', name: 'Bo', skills: ['QA'] }), extras, 0),
    ];
    expect(filterDirectory(list, { q: 'qa' }).map((p) => p.id)).toEqual(['b']);
    expect(filterDirectory(list, { skill: 'CSM' }).map((p) => p.id)).toEqual(['b']);
    expect(filterDirectory(list, { role: 'admin' }).map((p) => p.id)).toEqual(['a']);
    expect(filterDirectory(list, {}).length).toBe(2);
  });

  it('cleans tags', () => {
    expect(cleanTags([' QA', 'QA', '', 'FHIR '])).toEqual(['QA', 'FHIR']);
  });
});

describe('grid', () => {
  it('stacks visible projects and shows hidden hours as other', () => {
    const weeks = ['2026-10-12'];
    const g = buildGrid({
      weeks,
      people: [person({ id: 'u1', name: 'Tiara' })],
      projects: [{ id: 'p1', key: 'EHR', name: 'EHR', editable: true }],
      members: [
        { projectId: 'p1', userId: 'u1' },
        { projectId: 'p2', userId: 'u1' },
      ],
      allocations: [
        { projectId: 'p1', userId: 'u1', week: weeks[0], hours: 24 },
        { projectId: 'p2', userId: 'u1', week: weeks[0], hours: 99 },
      ],
      totals: [{ userId: 'u1', week: weeks[0], hours: 36 }],
    });
    expect(g.rows[0].person.memberOf).toEqual(['p1']);
    expect(g.rows[0].cells[0]).toEqual({
      week: weeks[0],
      projects: [{ projectId: 'p1', projectKey: 'EHR', hours: 24, editable: true }],
      otherHours: 12,
      hours: 36,
      pct: 90,
      level: 'amber',
    });
  });
});
