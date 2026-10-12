import { describe, expect, it } from 'vitest';
import type { ItemStatus, Sprint } from './types';
import {
  addDays,
  averageVelocity,
  burndown,
  cumulativeFlow,
  cycleTimes,
  percentile,
  projectMetrics,
  sprintDays,
  statusAt,
  throughput,
  velocity,
  weekStart,
  type MetricItem,
  type StatusChange,
} from './metrics';

const item = (id: string, over: Partial<MetricItem> = {}): MetricItem => ({
  id,
  key: id.toUpperCase(),
  title: `Item ${id}`,
  type: 'story',
  status: 'backlog',
  estimate: 3,
  sprintId: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  deletedAt: null,
  ...over,
});

let seq = 0;
const ch = (itemId: string, from: ItemStatus, to: ItemStatus, at: string): StatusChange => ({
  id: `h${seq++}`,
  projectId: 'p',
  itemId,
  from,
  to,
  at: at.length === 10 ? `${at}T15:00:00.000Z` : at,
});

const sprint = (id: string, start: string, end: string, status: Sprint['status']): Sprint => ({
  id,
  projectId: 'p',
  phaseId: 'ph',
  name: id,
  startDate: start,
  endDate: end,
  goal: '',
  status,
});

describe('dates', () => {
  it('weekStart is the Monday of the ISO week, Sunday belongs to the previous week', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-16')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });

  it('sprintDays skips weekends', () => {
    expect(sprintDays('2026-10-05', '2026-10-16')).toHaveLength(10);
    expect(sprintDays('2026-10-10', '2026-10-11')).toEqual(['2026-10-10', '2026-10-11']);
  });
});

describe('statusAt', () => {
  const i = item('a', { status: 'done' });
  const h = [ch('a', 'ready', 'in_progress', '2026-09-10'), ch('a', 'in_progress', 'done', '2026-09-12')];
  it('replays the history, using the first change’s `from` before it', () => {
    expect(statusAt(i, h, '2026-09-05T00:00:00.000Z')).toBe('ready');
    expect(statusAt(i, h, '2026-09-11T00:00:00.000Z')).toBe('in_progress');
    expect(statusAt(i, h, '2026-09-13T00:00:00.000Z')).toBe('done');
  });
  it('is null before the item existed and the current status with no history', () => {
    expect(statusAt(i, h, '2026-08-01T00:00:00.000Z')).toBeNull();
    expect(statusAt(item('b', { status: 'ready' }), [], '2026-09-20T00:00:00.000Z')).toBe('ready');
  });
});

describe('velocity', () => {
  const sprints = [
    sprint('s1', '2026-09-07', '2026-09-18', 'completed'),
    sprint('s2', '2026-09-21', '2026-10-02', 'completed'),
    sprint('s3', '2026-10-05', '2026-10-16', 'active'),
    sprint('s4', '2026-10-19', '2026-10-30', 'planned'),
  ];
  const items = [
    item('a', { sprintId: 's1', estimate: 5, status: 'done' }),
    item('b', { sprintId: 's2', estimate: 3, status: 'done' }), // committed in s1, finished in s2
    item('c', { sprintId: 's3', estimate: 8, status: 'in_progress' }),
    item('e', { type: 'epic', sprintId: 's3', estimate: 40 }),
  ];
  const history = [
    ch('a', 'in_progress', 'done', '2026-09-15'),
    ch('b', 'in_progress', 'done', '2026-09-23'),
  ];
  const commitments = [{ sprintId: 's1', itemIds: ['a', 'b'], at: '2026-09-07T09:00:00.000Z' }];

  it('uses the commitment snapshot when there is one and counts work done inside the sprint', () => {
    const v = velocity(sprints, items, history, commitments);
    expect(v.map((x) => x.sprint)).toEqual(['s1', 's2', 's3']);
    expect(v[0]).toMatchObject({ committed: 8, completed: 5, inProgress: false });
    expect(v[1]).toMatchObject({ committed: 3, completed: 3 });
    expect(v[2]).toMatchObject({ committed: 8, completed: 0, inProgress: true }); // epics never count
  });

  it('keeps only the last n started sprints and averages finished ones', () => {
    const v = velocity(sprints, items, history, commitments, 2);
    expect(v.map((x) => x.sprint)).toEqual(['s2', 's3']);
    expect(averageVelocity(velocity(sprints, items, history, commitments))).toBe(4);
    expect(averageVelocity([])).toBe(0);
  });
});

describe('burndown', () => {
  const s = sprint('s', '2026-10-05', '2026-10-16', 'active');
  const items = [
    item('a', { sprintId: 's', estimate: 5, status: 'done' }),
    item('b', { sprintId: 's', estimate: 5, status: 'in_progress' }),
  ];
  const history = [ch('a', 'in_progress', 'done', '2026-10-07')];

  it('draws the ideal line from scope to zero and actual remaining up to today', () => {
    const b = burndown(s, items, history, '2026-10-09');
    expect(b.total).toBe(10);
    expect(b.points).toHaveLength(10);
    expect(b.points[0]).toMatchObject({ day: '2026-10-05', ideal: 10, actual: 10 });
    expect(b.points[9]).toMatchObject({ day: '2026-10-16', ideal: 0, actual: null });
    expect(b.points.find((p) => p.day === '2026-10-07')!.actual).toBe(5);
    expect(b.points.find((p) => p.day === '2026-10-12')!.actual).toBeNull();
  });

  it('keeps committed items that left the sprint in scope', () => {
    const moved = [...items, item('c', { sprintId: null, estimate: 2 })];
    const b = burndown(s, moved, history, '2026-10-09', { sprintId: 's', itemIds: ['c'], at: '' });
    expect(b.total).toBe(12);
  });
});

describe('cumulative flow', () => {
  it('counts each item in its status at the end of each day', () => {
    const items = [
      item('a', { status: 'done', createdAt: '2026-10-01T09:00:00.000Z' }),
      item('b', { status: 'ready', createdAt: '2026-10-03T09:00:00.000Z' }),
      item('f', { type: 'feature' }),
    ];
    const history = [
      ch('a', 'backlog', 'in_progress', '2026-10-02'),
      ch('a', 'in_progress', 'done', '2026-10-04'),
    ];
    const cfd = cumulativeFlow(items, history, '2026-10-05', 5);
    expect(cfd.map((d) => d.day)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(cfd[0]).toMatchObject({ backlog: 1, in_progress: 0, ready: 0 });
    expect(cfd[1]).toMatchObject({ backlog: 0, in_progress: 1 });
    expect(cfd[2]).toMatchObject({ in_progress: 1, ready: 1 });
    expect(cfd[4]).toMatchObject({ done: 1, ready: 1, in_progress: 0 });
  });
});

describe('cycle time', () => {
  it('measures first In Progress to first Done, skipping unfinished work', () => {
    const items = [item('a', { status: 'accepted' }), item('b', { status: 'in_progress' }), item('c')];
    const history = [
      ch('a', 'ready', 'in_progress', '2026-10-01T12:00:00.000Z'),
      ch('a', 'in_progress', 'in_review', '2026-10-02T12:00:00.000Z'),
      ch('a', 'in_review', 'in_progress', '2026-10-03T12:00:00.000Z'),
      ch('a', 'in_progress', 'done', '2026-10-04T00:00:00.000Z'),
      ch('a', 'done', 'accepted', '2026-10-06T12:00:00.000Z'),
      ch('b', 'ready', 'in_progress', '2026-10-01T12:00:00.000Z'),
      ch('c', 'backlog', 'done', '2026-10-01T12:00:00.000Z'),
    ];
    const pts = cycleTimes(items, history);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ key: 'A', days: 2.5 });
  });

  it('percentile uses nearest rank', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 85)).toBe(9);
    expect(percentile([7], 85)).toBe(7);
  });
});

describe('throughput', () => {
  it('counts moves into Done/Accepted per week, once per finish', () => {
    const items = [item('a'), item('b'), item('e', { type: 'epic' })];
    const history = [
      ch('a', 'in_progress', 'done', '2026-10-06'),
      ch('a', 'done', 'accepted', '2026-10-07'), // already finished: not counted again
      ch('b', 'in_review', 'accepted', '2026-10-12'),
      ch('e', 'in_progress', 'done', '2026-10-12'),
      ch('b', 'backlog', 'done', '2026-08-01'), // outside the window
    ];
    expect(throughput(items, history, '2026-10-14', 3)).toEqual([
      { weekStart: '2026-09-28', count: 0 },
      { weekStart: '2026-10-05', count: 1 },
      { weekStart: '2026-10-12', count: 1 },
    ]);
  });
});

describe('projectMetrics', () => {
  it('bundles every chart and the active sprint burndown', () => {
    const m = projectMetrics({
      sprints: [sprint('s', '2026-10-05', '2026-10-16', 'active')],
      items: [item('a', { sprintId: 's', status: 'done' })],
      history: [ch('a', 'ready', 'in_progress', '2026-10-05'), ch('a', 'in_progress', 'done', '2026-10-06')],
      commitments: [],
      today: '2026-10-08',
    });
    expect(m.burndown?.sprint).toBe('s');
    expect(m.cumulativeFlow).toHaveLength(30);
    expect(m.cycleTime).toMatchObject({ p50: 1, p85: 1 });
    expect(m.throughput.at(-1)).toEqual({ weekStart: '2026-10-05', count: 1 });
    expect(
      projectMetrics({ sprints: [], items: [], history: [], commitments: [], today: '2026-10-08' }).burndown,
    ).toBeNull();
  });
});
