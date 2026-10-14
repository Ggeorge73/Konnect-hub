import { describe, expect, it } from 'vitest';
import type { Phase, Sprint } from '@/lib/domain/types';
import { barAriaLabel, buildTimeline, shiftSpan, type TimelineInput, type TimelineItemLike } from './layout';
import { timelineCriticalPath, timelineNetwork } from './critical';

const phase = (gate: 1 | 2 | 3 | 4 | 5, dates: [string, string]): Phase => ({
  id: `ph${gate}`,
  projectId: 'p',
  gate,
  name: ['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'][gate - 1],
  status: gate < 3 ? 'approved' : gate === 3 ? 'active' : 'not_started',
  startDate: dates[0],
  endDate: dates[1],
});
const PHASES = [
  phase(1, ['2026-01-01', '2026-01-10']),
  phase(2, ['2026-01-11', '2026-01-20']),
  phase(3, ['2026-01-21', '2026-03-31']),
  phase(4, ['2026-04-01', '2026-04-15']),
  phase(5, ['2026-04-16', '2026-04-30']),
];
const SPRINT: Sprint = {
  id: 's1',
  projectId: 'p',
  phaseId: 'ph3',
  name: 'Sprint 1',
  startDate: '2026-01-21',
  endDate: '2026-02-03',
  goal: '',
  status: 'active',
};
const item = (id: string, type: TimelineItemLike['type'], extra: Partial<TimelineItemLike> = {}) => ({
  id,
  key: id.toUpperCase(),
  title: id,
  type,
  status: 'in_progress',
  phaseId: 'ph3',
  ...extra,
});

function input(extra: Partial<TimelineInput> = {}): TimelineInput {
  return {
    project: { key: 'T', name: 'Test', startDate: '2026-01-01', targetDate: '2026-04-30' },
    phases: PHASES,
    sprints: [SPRINT],
    items: [
      item('e1', 'epic'),
      item('s11', 'story', { parentId: 'e1', sprintId: 's1' }),
      item('e2', 'epic'),
      item('t21', 'task', { parentId: 'e2', dueDate: '2026-02-20' }),
      item('e3', 'epic', { phaseId: 'ph1' }),
    ],
    links: [{ id: 'l12', fromId: 'e1', toId: 'e2', type: 'blocks' }],
    schedules: [{ itemId: 'e2', startDate: '2026-02-01', endDate: '2026-02-28' }],
    ...extra,
  };
}

describe('timelineNetwork', () => {
  it('builds epic, item and sprint-end milestone nodes in the Execute phase only', () => {
    const inp = input();
    const model = buildTimeline(inp, 'month', '2026-02-01');
    const net = timelineNetwork(model, inp, 'execute');
    expect(net.nodes.map((n) => n.id).sort()).toEqual(['e1', 'e2', 'ms_s1', 's11', 't21']);
    expect(net.nodes.find((n) => n.id === 'ms_s1')!.duration).toBe(0);
    expect(net.labels.get('ms_s1')).toBe('Sprint 1 ends');
    const all = timelineNetwork(model, inp, 'all');
    expect(all.nodes.map((n) => n.id)).toContain('e3');
  });
});

describe('timelineCriticalPath', () => {
  it('pushes the blocked epic after its blocker and marks both critical', () => {
    const inp = input();
    const model = buildTimeline(inp, 'month', '2026-02-01');
    const r = timelineCriticalPath(model, inp, { scope: 'execute' });
    // e1 spans its child's sprint (21 Jan – 3 Feb); e2 (scheduled 1–28 Feb, 28 days) is pushed to
    // start 4 Feb, so it finishes 3 Mar.
    expect([...r.bars].sort()).toEqual(['e1', 'e2']);
    expect([...r.arrows]).toEqual(['l12']);
    expect(r.chain).toEqual(['E1', 'E2']);
    expect(r.finish).toBe('2026-03-03');
    expect(r.float.get('e1')).toBe(0);
    expect(r.float.has('e3')).toBe(false); // out of scope
  });

  it('includes other phases with scope "all"', () => {
    const inp = input();
    const model = buildTimeline(inp, 'month', '2026-02-01');
    const r = timelineCriticalPath(model, inp, { scope: 'all' });
    expect(r.float.get('e3')).toBeGreaterThan(0);
  });

  it('recomputes when a bar is dragged (laid-out bar span wins)', () => {
    const inp = input({ links: [] });
    const model = buildTimeline(inp, 'month', '2026-02-01');
    expect([...timelineCriticalPath(model, inp, { scope: 'execute' }).bars]).toEqual(['e2']);
    // Drag e1 far to the right: now it finishes last and becomes the critical one.
    const dragged = {
      ...model,
      bars: model.bars.map((b) => (b.id === 'e1' ? { ...b, ...shiftSpan(b, 60) } : b)),
    };
    const r = timelineCriticalPath(dragged, inp, { scope: 'execute' });
    expect([...r.bars]).toEqual(['e1']);
    expect(r.float.get('e2')).toBeGreaterThan(0);
  });

  it('reports cycles by item key without crashing', () => {
    const inp = input({
      links: [
        { id: 'a', fromId: 'e1', toId: 'e2', type: 'blocks' },
        { id: 'b', fromId: 'e2', toId: 'e1', type: 'blocks' },
      ],
    });
    const model = buildTimeline(inp, 'month', '2026-02-01');
    const r = timelineCriticalPath(model, inp, { scope: 'execute' });
    expect(r.cycles).toEqual([['E1', 'E2']]);
    expect(r.arrows.size).toBe(0);
    expect(r.bars.size).toBeGreaterThan(0);
  });

  it('announces float and critical status in the bar label', () => {
    const inp = input();
    const model = buildTimeline(inp, 'month', '2026-02-01');
    const bar = model.bars.find((b) => b.id === 'e1')!;
    expect(barAriaLabel(bar, { editable: false, critical: true, float: 0 })).toMatch(
      /float 0 days, on the critical path\.$/,
    );
    expect(barAriaLabel(bar, { editable: true, float: 1 })).toContain('float 1 day.');
  });
});
