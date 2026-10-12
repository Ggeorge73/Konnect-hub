import { describe, expect, it } from 'vitest';
import {
  canStartSprint,
  capacity,
  defaultPhaseId,
  nextPlannedSprint,
  planCompletion,
  plannedHours,
  suggestSprintDates,
  validateSprint,
} from './sprints';
import type { Sprint, WorkItem } from './types';

const sprint = (id: string, status: Sprint['status'], startDate: string, projectId = 'p1'): Sprint => ({
  id,
  projectId,
  phaseId: 'ph3',
  name: id.toUpperCase(),
  startDate,
  endDate: startDate,
  goal: '',
  status,
});

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    key: id.toUpperCase(),
    projectId: 'p1',
    type: 'story',
    status: 'in_progress',
    estimate: 3,
    sprintId: null,
    position: 1000,
    ...over,
  }) as WorkItem;

describe('capacity math', () => {
  it('sums hour estimates as-is', () => {
    expect(plannedHours([item('a', { estimate: 4 }), item('b', { estimate: 2.5 })], 'hours')).toBe(6.5);
  });
  it('converts points with the default 6 hours per point', () => {
    expect(plannedHours([item('a', { estimate: 3 }), item('b', { estimate: 5 })], 'points')).toBe(48);
  });
  it('uses a per-project hours-per-point', () => {
    expect(plannedHours([item('a', { estimate: 3 })], 'points', 8)).toBe(24);
  });
  it('treats missing estimates as zero and ignores epics and features', () => {
    expect(
      plannedHours(
        [
          item('a', { estimate: null }),
          item('e', { type: 'epic', estimate: 40 }),
          item('f', { type: 'feature' }),
        ],
        'hours',
      ),
    ).toBe(0);
  });
  it('is within capacity at exactly 100%', () => {
    const c = capacity(40, 40);
    expect(c.level).toBe('ok');
    expect(c.label).toBe('40 of 40 h · 100% · Within capacity');
  });
  it('turns amber above 100%', () => {
    const c = capacity(41, 40);
    expect(c.level).toBe('over');
    expect(c.label).toContain('Over capacity');
  });
  it('stays amber at exactly 120% and turns red above it', () => {
    expect(capacity(48, 40).level).toBe('over');
    const c = capacity(49, 40);
    expect(c.level).toBe('critical');
    expect(c.label).toContain('123%');
    expect(c.label).toContain('Overloaded');
  });
  it('labels sprints without capacity', () => {
    const c = capacity(12, undefined);
    expect(c.level).toBe('none');
    expect(c.ratio).toBeNull();
    expect(c.label).toBe('12 h planned · no capacity set');
  });
});

describe('sprint validation', () => {
  const ok = { name: 'S1', phaseId: 'x', startDate: '2026-10-05', endDate: '2026-10-16' };
  it('accepts a valid sprint', () => expect(validateSprint(ok)).toEqual([]));
  it('requires end after start', () => {
    expect(validateSprint({ ...ok, endDate: '2026-10-05' })).toContain(
      'End date must be after the start date.',
    );
    expect(validateSprint({ ...ok, endDate: '2026-10-01' })).toContain(
      'End date must be after the start date.',
    );
  });
  it('requires a name and non-negative capacity', () => {
    expect(validateSprint({ ...ok, name: '  ', capacityHours: -1 })).toEqual([
      'Name is required.',
      'Capacity hours cannot be negative.',
    ]);
  });
  it('rejects malformed dates', () => {
    expect(validateSprint({ ...ok, startDate: '10/05/2026' })).toContain('Start date is invalid.');
  });
});

describe('single active sprint', () => {
  const s1 = sprint('s1', 'active', '2026-10-05');
  const s2 = sprint('s2', 'planned', '2026-10-19');
  it('blocks a second active sprint with a clear reason', () => {
    const r = canStartSprint(s2, [s1, s2]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/S1 is still active\. Complete it before starting S2/);
  });
  it('allows starting when no sprint is active', () => {
    expect(canStartSprint(s2, [{ ...s1, status: 'completed' }, s2])).toEqual({ ok: true });
  });
  it('ignores active sprints in other projects', () => {
    expect(canStartSprint(s2, [{ ...s1, projectId: 'p2' }, s2])).toEqual({ ok: true });
  });
  it('cannot restart an active or completed sprint', () => {
    expect(canStartSprint(s1, [s1]).ok).toBe(false);
    expect(canStartSprint({ ...s2, status: 'completed' }, [s2]).ok).toBe(false);
  });
});

describe('completion carry-over', () => {
  const active = sprint('s1', 'active', '2026-10-05');
  const later = sprint('s3', 'planned', '2026-11-02');
  const next = sprint('s2', 'planned', '2026-10-19');
  const all = [active, later, next];
  const items = [
    item('done', { sprintId: 's1', status: 'done', position: 1000 }),
    item('acc', { sprintId: 's1', status: 'accepted', position: 2000 }),
    item('wip2', { sprintId: 's1', status: 'in_review', position: 4000 }),
    item('wip1', { sprintId: 's1', status: 'backlog', position: 3000 }),
    item('there', { sprintId: 's2', position: 5000 }),
    item('back', { sprintId: null, position: 9000 }),
  ];

  it('finds the earliest planned sprint as next', () =>
    expect(nextPlannedSprint(active, all)?.id).toBe('s2'));

  it('moves unfinished work to the next planned sprint, after its existing items, in order', () => {
    const plan = planCompletion(active, all, items, 'next');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.targetSprintId).toBe('s2');
    expect(plan.unfinished.map((i) => i.id)).toEqual(['wip1', 'wip2']);
    expect(plan.moves).toEqual([
      { itemId: 'wip1', sprintId: 's2', position: 6000 },
      { itemId: 'wip2', sprintId: 's2', position: 7000 },
    ]);
  });

  it('moves unfinished work to the backlog when asked', () => {
    const plan = planCompletion(active, all, items, 'backlog');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.targetSprintId).toBeNull();
    expect(plan.moves.map((m) => [m.itemId, m.sprintId, m.position])).toEqual([
      ['wip1', null, 10000],
      ['wip2', null, 11000],
    ]);
  });

  it('refuses "next" when no planned sprint exists and work is unfinished', () => {
    const plan = planCompletion(active, [active], items, 'next');
    expect(plan).toEqual({ error: expect.stringMatching(/no planned sprint/) });
  });

  it('only completes an active sprint', () => {
    expect(planCompletion(next, all, items, 'backlog')).toEqual({ error: expect.any(String) });
  });
});

describe('sprint defaults', () => {
  it('defaults the phase to the active one', () => {
    expect(
      defaultPhaseId([
        { id: 'a', gate: 1, status: 'approved' },
        { id: 'c', gate: 3, status: 'not_started' },
        { id: 'b', gate: 2, status: 'active' },
      ]),
    ).toBe('b');
  });
  it('suggests two weeks after the latest sprint', () => {
    expect(suggestSprintDates([sprint('s1', 'active', '2026-10-05')], '2026-10-01')).toEqual({
      startDate: '2026-10-06',
      endDate: '2026-10-19',
    });
    expect(suggestSprintDates([], '2026-10-12')).toEqual({ startDate: '2026-10-12', endDate: '2026-10-25' });
  });
});
