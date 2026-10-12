import { describe, expect, it } from 'vitest';
import {
  arrowPath,
  barAriaLabel,
  buildTimeline,
  dragDays,
  epicSpan,
  formatDate,
  HEADER_H,
  periodStart,
  phaseSpans,
  PX_PER_DAY,
  shiftSpan,
  ticks,
  type Bar,
  type TimelineInput,
} from './layout';
import type { Phase, Sprint } from '@/lib/domain/types';

const phase = (gate: 1 | 2 | 3 | 4 | 5, status: Phase['status'], dates?: [string, string]): Phase => ({
  id: `ph${gate}`,
  projectId: 'p',
  gate,
  name: ['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'][gate - 1],
  status,
  ...(dates ? { startDate: dates[0], endDate: dates[1] } : {}),
});
const PHASES = [
  phase(1, 'approved'),
  phase(2, 'approved_with_conditions'),
  phase(3, 'active'),
  phase(4, 'not_started'),
  phase(5, 'not_started'),
];
const project = { key: 'T', name: 'Test', startDate: '2026-01-01', targetDate: '2026-02-19' }; // 50 days

const sprint = (
  id: string,
  startDate: string,
  endDate: string,
  status: Sprint['status'] = 'planned',
): Sprint => ({
  id,
  projectId: 'p',
  phaseId: 'ph3',
  name: id,
  startDate,
  endDate,
  goal: '',
  status,
});

describe('dates', () => {
  it('formats without locale', () => expect(formatDate('2026-10-05')).toBe('5 Oct 2026'));
  it('shifts spans across month ends', () =>
    expect(shiftSpan({ start: '2026-01-30', end: '2026-02-02' }, 3)).toEqual({
      start: '2026-02-02',
      end: '2026-02-05',
    }));
  it('snaps drags to whole days at each zoom', () => {
    expect(dragDays(41, 'week')).toBe(1); // 28 px/day
    expect(dragDays(13, 'week')).toBe(0);
    expect(dragDays(-17, 'month')).toBe(-2); // 8 px/day
    expect(dragDays(30, 'quarter')).toBe(10); // 3 px/day
  });
  it('finds period starts', () => {
    expect(periodStart('2026-10-15', 'week')).toBe('2026-10-12'); // Monday
    expect(periodStart('2026-10-15', 'month')).toBe('2026-10-01');
    expect(periodStart('2026-11-15', 'quarter')).toBe('2026-10-01');
  });
  it('builds ticks per zoom', () => {
    expect(ticks('2026-10-01', '2026-12-31', 'month').map((t) => t.label)).toEqual([
      'Oct 2026',
      'Nov 2026',
      'Dec 2026',
    ]);
    expect(ticks('2026-10-01', '2027-04-01', 'quarter').map((t) => t.label)).toEqual([
      'Q4 2026',
      'Q1 2027',
      'Q2 2027',
    ]);
    const w = ticks('2026-10-12', '2026-10-26', 'week');
    expect(w.map((t) => [t.label, t.x])).toEqual([
      ['12 Oct', 0],
      ['19 Oct', 7 * PX_PER_DAY.week],
      ['26 Oct', 14 * PX_PER_DAY.week],
    ]);
  });
});

describe('phase spans', () => {
  it('splits the project evenly across five phases when phases have no dates', () => {
    const spans = phaseSpans(project, PHASES);
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      ['2026-01-01', '2026-01-10'],
      ['2026-01-11', '2026-01-20'],
      ['2026-01-21', '2026-01-30'],
      ['2026-01-31', '2026-02-09'],
      ['2026-02-10', '2026-02-19'],
    ]);
    expect(spans.every((s) => s.derived)).toBe(true);
  });
  it('uses phase dates when set', () => {
    const spans = phaseSpans(project, [
      phase(1, 'approved', ['2025-12-01', '2025-12-20']),
      ...PHASES.slice(1),
    ]);
    expect(spans[0]).toMatchObject({ start: '2025-12-01', end: '2025-12-20', derived: false });
    expect(spans[1].derived).toBe(true);
  });
});

describe('epic spans', () => {
  const phases = phaseSpans(project, PHASES);
  const sprints = [sprint('s1', '2026-01-21', '2026-01-30'), sprint('s2', '2026-02-02', '2026-02-13')];
  const epic = { id: 'e', key: 'T-1', title: 'Epic', type: 'epic' as const, status: 'ready', phaseId: 'ph3' };
  const items = [
    epic,
    { id: 'f', key: 'T-2', title: 'F', type: 'feature' as const, status: 'ready', parentId: 'e' },
    {
      id: 'a',
      key: 'T-3',
      title: 'A',
      type: 'story' as const,
      status: 'ready',
      parentId: 'f',
      sprintId: 's1',
    },
    {
      id: 'b',
      key: 'T-4',
      title: 'B',
      type: 'story' as const,
      status: 'ready',
      parentId: 'f',
      dueDate: '2026-02-16',
    },
  ];
  it('spans min/max of descendants’ sprint and due dates', () => {
    expect(epicSpan(epic, items, sprints, [], phases, project)).toEqual({
      start: '2026-01-21',
      end: '2026-02-16',
      source: 'children',
    });
  });
  it('falls back to its phase, then the project', () => {
    expect(epicSpan(epic, [epic], sprints, [], phases, project)).toMatchObject({
      start: '2026-01-21',
      end: '2026-01-30',
      source: 'phase',
    });
    expect(epicSpan({ ...epic, phaseId: null }, [epic], sprints, [], phases, project)).toMatchObject({
      start: '2026-01-01',
      end: '2026-02-19',
      source: 'project',
    });
  });
  it('prefers an explicit schedule', () => {
    expect(
      epicSpan(
        epic,
        items,
        sprints,
        [{ itemId: 'e', startDate: '2026-01-05', endDate: '2026-01-09' }],
        phases,
        project,
      ),
    ).toEqual({ start: '2026-01-05', end: '2026-01-09', source: 'schedule' });
  });
});

describe('buildTimeline', () => {
  const input: TimelineInput = {
    project,
    phases: PHASES,
    sprints: [sprint('s2', '2026-02-02', '2026-02-13'), sprint('s1', '2026-01-19', '2026-01-30', 'active')],
    items: [
      { id: 'e1', key: 'T-1', title: 'One', type: 'epic', status: 'ready', phaseId: 'ph2' },
      { id: 'e2', key: 'T-2', title: 'Two', type: 'epic', status: 'ready', phaseId: 'ph4' },
      { id: 'x', key: 'T-3', title: 'Story', type: 'story', status: 'ready' },
    ],
    links: [
      { id: 'l1', fromId: 'e1', toId: 'e2', type: 'blocks' },
      { id: 'l2', fromId: 'x', toId: 'e2', type: 'blocks' },
      { id: 'l3', fromId: 'e1', toId: 'e2', type: 'relates' },
    ],
    schedules: [],
  };
  const m = buildTimeline(input, 'week', '2026-01-25');

  it('lays out 5 phase bands and a gate at each phase end, marking passed gates', () => {
    expect(m.phases).toHaveLength(5);
    expect(m.gates.map((g) => g.passed)).toEqual([true, true, false, false, false]);
    expect(m.gates[0].x).toBe(m.phases[0].x + m.phases[0].w);
  });
  it('starts on a period boundary before the earliest date and puts bars in rows (sprints first)', () => {
    expect(m.start).toBe('2025-12-29'); // Monday on or before 3 days before 1 Jan
    expect(m.bars.map((b) => [b.id, b.row])).toEqual([
      ['s1', 0],
      ['s2', 1],
      ['e1', 2],
      ['e2', 3],
    ]);
    const s1 = m.bars[0];
    expect(s1.x).toBe(21 * PX_PER_DAY.week); // 29 Dec → 19 Jan
    expect(s1.w).toBe(12 * PX_PER_DAY.week); // inclusive end
    expect(s1.y).toBeGreaterThanOrEqual(HEADER_H);
  });
  it('draws arrows only for blocks links between items with bars', () => {
    expect(m.arrows.map((a) => a.id)).toEqual(['l1']);
  });
  it('adds sprint-end and target-date milestones', () => {
    expect(m.milestones.map((x) => x.label)).toEqual(['s1 ends', 's2 ends', 'Target date']);
  });
  it('places today, or omits it when out of range', () => {
    expect(m.today).toEqual({ date: '2026-01-25', x: 27 * PX_PER_DAY.week + PX_PER_DAY.week / 2 });
    expect(buildTimeline(input, 'month', '2026-01-25').today).not.toBeNull();
  });
  it('scales with zoom', () => {
    const q = buildTimeline(input, 'quarter', '2026-01-25');
    expect(q.start).toBe('2025-10-01');
    expect(q.bars[0].w).toBe(12 * PX_PER_DAY.quarter);
  });
});

describe('arrows and labels', () => {
  const bar = (id: string, x: number, row: number, w = 50): Bar => ({
    id,
    kind: 'epic',
    label: id,
    key: id,
    status: 'ready',
    start: '2026-01-01',
    end: '2026-01-02',
    row,
    x,
    y: HEADER_H + row * 36 + 8,
    w,
  });
  it('routes a straight elbow when there is room', () => {
    expect(arrowPath(bar('a', 0, 0), bar('b', 100, 1))).toBe(
      `M 50 ${HEADER_H + 18} H 58 V ${HEADER_H + 36 + 18} H 100`,
    );
  });
  it('routes around when the target starts before the source ends', () => {
    expect(arrowPath(bar('a', 0, 0), bar('b', 20, 1)).split(' V ')).toHaveLength(3);
  });
  it('describes bars for screen readers', () => {
    expect(barAriaLabel(bar('T-1', 0, 0), { editable: true })).toBe(
      'Epic T-1: T-1, ready, 1 Jan 2026 to 2 Jan 2026. Use Left and Right arrow keys to move by one day.',
    );
    expect(barAriaLabel(bar('T-1', 0, 0), { editable: false, critical: true })).toMatch(/critical path\.$/);
  });
});
