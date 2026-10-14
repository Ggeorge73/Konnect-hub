import { describe, expect, it } from 'vitest';
import {
  AI_ENABLED_BY_DEFAULT,
  canToggleAi,
  canUseAiFeature,
  detectRiskSignals,
  settingsFor,
  undecidedSignals,
  type SignalInput,
  type SignalItem,
} from './ai';
import type { Profile, Project } from './types';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const person = (id: string, role: Profile['role']): Profile =>
  ({ id, role, orgId: 'org', name: id, email: `${id}@x`, mfaEnabled: true, usPerson: true }) as Profile;
const project = { id: 'p1', key: 'P', leadId: 'lead' } as Project;

const item = (n: number, o: Partial<SignalItem> = {}): SignalItem => ({
  id: `i${n}`,
  key: `P-${n}`,
  title: `Item ${n}`,
  type: 'task',
  status: 'in_progress',
  estimate: 3,
  sprintId: null,
  dueDate: null,
  createdAt: '2026-09-01T09:00:00.000Z',
  visibility: 'shared',
  ...o,
});

const input = (o: Partial<SignalInput>): SignalInput => ({
  items: [],
  history: [],
  sprints: [],
  deliverables: [],
  now: NOW,
  ...o,
});

describe('AI settings rules', () => {
  it('is off by default for a project with no settings row', () => {
    expect(AI_ENABLED_BY_DEFAULT).toBe(false);
    expect(settingsFor([], 'p1')).toEqual({
      projectId: 'p1',
      enabled: false,
      updatedBy: null,
      updatedAt: null,
    });
    expect(
      settingsFor([{ projectId: 'p2', enabled: true, updatedBy: 'x', updatedAt: 't' }], 'p1').enabled,
    ).toBe(false);
  });

  it('only the project lead or an admin toggles AI', () => {
    expect(canToggleAi(person('lead', 'delivery_lead'), project)).toBe(true);
    expect(canToggleAi(person('other', 'delivery_lead'), project)).toBe(false);
    expect(canToggleAi(person('a', 'admin'), project)).toBe(true);
    expect(canToggleAi(person('t', 'team_member'), project)).toBe(false);
    expect(canToggleAi(person('s', 'client_sponsor'), project)).toBe(false);
  });

  it('features by role: clients only summarise threads', () => {
    const viewer = person('v', 'client_viewer');
    expect(canUseAiFeature(viewer, 'thread_summary')).toBe(true);
    expect(canUseAiFeature(viewer, 'status_report')).toBe(false);
    expect(canUseAiFeature(viewer, 'risk_suggestions')).toBe(false);
    expect(canUseAiFeature(viewer, 'meeting_notes')).toBe(false);
    expect(canUseAiFeature(person('as', 'associate'), 'meeting_notes')).toBe(true);
  });
});

describe('risk signal detector', () => {
  it('flags in-progress / in-review items with no status change for 7 days', () => {
    const items = [
      item(1),
      item(2, { status: 'in_review' }),
      item(3, { status: 'ready' }),
      item(4),
      item(5, { status: 'done' }),
    ];
    const history = [
      { itemId: 'i1', to: 'in_progress' as const, at: '2026-10-01T09:00:00.000Z' }, // 13 days
      { itemId: 'i2', to: 'in_review' as const, at: '2026-10-08T12:00:00.000Z' }, // 6 days
      { itemId: 'i4', to: 'in_progress' as const, at: '2026-10-13T09:00:00.000Z' }, // 1 day
      { itemId: 'i4', to: 'in_review' as const, at: '2026-09-01T09:00:00.000Z' }, // other status: ignored
    ];
    const out = detectRiskSignals(input({ items, history }));
    expect(out.map((s) => s.key)).toEqual(['stalled:i1']);
    expect(out[0]).toMatchObject({ kind: 'stalled', itemKeys: ['P-1'], visibility: 'shared' });
    expect(out[0].detail).toContain('13 days');
    // No history: counts from creation.
    expect(detectRiskSignals(input({ items: [item(9)] })).map((s) => s.key)).toEqual(['stalled:i9']);
  });

  it('looks ahead: a fresh item is flagged as stalled 14 days from now, not today', () => {
    const fresh = item(1, { createdAt: NOW.toISOString() });
    expect(detectRiskSignals(input({ items: [fresh] }))).toEqual([]);
    expect(detectRiskSignals(input({ items: [fresh], lookaheadDays: 14 })).map((s) => s.kind)).toEqual([
      'stalled',
    ]);
    // Look-ahead is capped at 30 days, and a custom threshold applies.
    expect(detectRiskSignals(input({ items: [fresh], lookaheadDays: 2, stalledDays: 2 }))).toHaveLength(1);
  });

  it('flags overdue items that are not done (epics and done items excluded)', () => {
    const items = [
      item(1, { status: 'ready', dueDate: '2026-10-10' }),
      item(2, { status: 'done', dueDate: '2026-10-01' }),
      item(3, { status: 'ready', type: 'epic', dueDate: '2026-10-01' }),
      item(4, { status: 'ready', dueDate: '2026-10-14' }),
      item(5, { status: 'backlog', dueDate: '2026-10-12', visibility: 'internal' }),
    ];
    const out = detectRiskSignals(input({ items }));
    expect(out.map((s) => s.key)).toEqual(['overdue:i1', 'overdue:i5']);
    expect(out[0].detail).toContain('4 days ago');
    expect(out[1].visibility).toBe('internal');
  });

  it('flags an active sprint whose burndown trends below 90% of scope', () => {
    const sprint = {
      id: 's1',
      name: 'Sprint 4',
      startDate: '2026-10-05',
      endDate: '2026-10-16',
      status: 'active' as const,
    };
    // 10 of 12 days gone; 3 of 12 points done -> projects ~4 points.
    const slipping = [
      item(1, { sprintId: 's1', status: 'done', estimate: 3 }),
      item(2, { sprintId: 's1', status: 'ready', estimate: 5 }),
      item(3, { sprintId: 's1', status: 'in_progress', estimate: 4, visibility: 'internal' }),
    ];
    const history = slipping.map((i) => ({ itemId: i.id, to: i.status, at: '2026-10-13T09:00:00.000Z' }));
    const out = detectRiskSignals(input({ items: slipping, history, sprints: [sprint] }));
    expect(out.map((s) => s.key)).toEqual(['sprint_miss:s1']);
    expect(out[0]).toMatchObject({ itemKeys: ['P-2', 'P-3'], visibility: 'internal' });
    // On track: 11 of 12 points done.
    const onTrack = slipping.map((i) => ({
      ...i,
      status: i.id === 'i2' ? ('ready' as const) : ('done' as const),
      estimate: i.id === 'i2' ? 1 : i.estimate,
    }));
    expect(
      detectRiskSignals(input({ items: onTrack, history: [], sprints: [sprint] })).filter(
        (s) => s.kind === 'sprint_miss',
      ),
    ).toEqual([]);
    // Too early in the sprint to judge.
    const early = { ...sprint, startDate: '2026-10-13', endDate: '2026-10-23' };
    expect(
      detectRiskSignals(input({ items: slipping, history, sprints: [early] })).filter(
        (s) => s.kind === 'sprint_miss',
      ),
    ).toEqual([]);
  });

  it('flags deliverables past due and not accepted', () => {
    const deliverables = [
      {
        id: 'd1',
        name: 'Data conversion',
        dueDate: '2026-10-09',
        status: 'submitted' as const,
        visibility: 'shared' as const,
        itemIds: ['i1'],
      },
      {
        id: 'd2',
        name: 'Templates',
        dueDate: '2026-10-01',
        status: 'accepted' as const,
        visibility: 'shared' as const,
        itemIds: [],
      },
      {
        id: 'd3',
        name: 'Training',
        dueDate: '2026-11-01',
        status: 'draft' as const,
        visibility: 'shared' as const,
        itemIds: [],
      },
    ];
    const out = detectRiskSignals(input({ items: [item(1, { status: 'done' })], deliverables }));
    expect(out.map((s) => s.key)).toEqual(['deliverable_late:d1']);
    expect(out[0]).toMatchObject({ itemKeys: ['P-1'] });
    expect(out[0].detail).toContain('awaiting acceptance');
  });

  it('is deterministic, ordered by kind, and drops decided signals', () => {
    const items = [item(2, { dueDate: '2026-10-01' }), item(1, { dueDate: '2026-10-02' })];
    const a = detectRiskSignals(input({ items }));
    expect(a.map((s) => s.key)).toEqual(['stalled:i1', 'stalled:i2', 'overdue:i1', 'overdue:i2']);
    expect(detectRiskSignals(input({ items: [...items].reverse() }))).toEqual(a);
    expect(undecidedSignals(a, ['stalled:i1', 'overdue:i2']).map((s) => s.key)).toEqual([
      'stalled:i2',
      'overdue:i1',
    ]);
  });

  it('ignores deleted items', () => {
    expect(detectRiskSignals(input({ items: [item(1, { deletedAt: '2026-10-01T00:00:00Z' })] }))).toEqual([]);
  });
});
