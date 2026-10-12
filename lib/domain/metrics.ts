import type { ItemStatus, Sprint, WorkItem } from './types';

/**
 * Agile metrics (AGL-01, CLAUDE.md 3.6): velocity, sprint burndown, cumulative flow, cycle time
 * and throughput. Pure functions over items, sprints and the status-change history.
 * No I/O and no clock reads: callers pass `today`.
 */

/** One status change of a work item. Recorded by `updateItem` (lib/data/pulse-history.ts). */
export interface StatusChange {
  id: string;
  projectId: string;
  itemId: string;
  from: ItemStatus | null;
  to: ItemStatus;
  at: string;
  actorId?: string;
}

/** Items committed to a sprint when it started (Jira-style snapshot). */
export interface SprintCommitment {
  sprintId: string;
  itemIds: string[];
  at: string;
}

export type MetricItem = Pick<
  WorkItem,
  'id' | 'key' | 'title' | 'type' | 'status' | 'estimate' | 'sprintId' | 'createdAt' | 'deletedAt'
>;

export const DONE_STATUSES: ItemStatus[] = ['done', 'accepted'];
export const isDone = (s: ItemStatus | null | undefined) => Boolean(s && DONE_STATUSES.includes(s));

/** Epics and features are containers: they never count towards flow metrics. */
export const isFlowItem = (i: Pick<WorkItem, 'type' | 'deletedAt'>) =>
  !i.deletedAt && i.type !== 'epic' && i.type !== 'feature';

/** Board order, used for cumulative flow bands (bottom band = most finished). */
export const FLOW_STATUSES: ItemStatus[] = [
  'backlog',
  'ready',
  'in_progress',
  'in_review',
  'client_review',
  'done',
  'accepted',
];

const DAY_MS = 86_400_000;
const points = (i: Pick<WorkItem, 'estimate'>) => i.estimate ?? 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** YYYY-MM-DD of a Date or ISO timestamp (UTC). */
export const isoDay = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
export const addDays = (day: string, n: number) =>
  isoDay(new Date(new Date(day + 'T00:00:00Z').getTime() + n * DAY_MS));
/** End of a calendar day (exclusive bound) as an ISO string. */
const endOfDay = (day: string) => addDays(day, 1) + 'T00:00:00.000Z';

/** Monday of the ISO week containing `day` (UTC). */
export function weekStart(day: string): string {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** History grouped by item, oldest change first. */
export function historyByItem(history: StatusChange[]): Map<string, StatusChange[]> {
  const m = new Map<string, StatusChange[]>();
  for (const h of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
    const list = m.get(h.itemId) ?? [];
    list.push(h);
    m.set(h.itemId, list);
  }
  return m;
}

/**
 * Status of an item at instant `at` (ISO, exclusive). Before its first recorded change an item
 * is in that change's `from` status; with no history it has always been in its current status.
 * Returns null when the item did not exist yet.
 */
export function statusAt(
  item: MetricItem,
  changes: StatusChange[] | undefined,
  at: string,
): ItemStatus | null {
  if (item.createdAt >= at) return null;
  if (!changes?.length) return item.status;
  let s: ItemStatus | null = changes[0].from ?? null;
  for (const c of changes) {
    if (c.at >= at) break;
    s = c.to;
  }
  return s ?? changes[0].to;
}

/** When the item first entered a done status inside [from, to), or null. */
function doneWithin(changes: StatusChange[] | undefined, from: string, to: string): string | null {
  for (const c of changes ?? [])
    if (c.at >= from && c.at < to && isDone(c.to) && !isDone(c.from)) return c.at;
  return null;
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

export interface VelocityPoint {
  sprintId: string;
  sprint: string;
  committed: number;
  completed: number;
  inProgress: boolean;
}

/**
 * Committed vs completed points for the last `n` sprints that have started (completed or active).
 * Committed = points of the items in the start-of-sprint commitment snapshot, or of the items now
 * in the sprint when no snapshot exists. Completed = points of committed or sprint items that
 * reached Done/Accepted between the sprint's first and last day.
 */
export function velocity(
  sprints: Sprint[],
  items: MetricItem[],
  history: StatusChange[],
  commitments: SprintCommitment[] = [],
  n = 6,
): VelocityPoint[] {
  const byItem = historyByItem(history);
  const flow = items.filter(isFlowItem);
  return sprints
    .filter((s) => s.status !== 'planned')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-n)
    .map((s) => {
      const snap = commitments.find((c) => c.sprintId === s.id);
      const committedIds = new Set(
        snap ? snap.itemIds : flow.filter((i) => i.sprintId === s.id).map((i) => i.id),
      );
      const committed = flow.filter((i) => committedIds.has(i.id)).reduce((t, i) => t + points(i), 0);
      const from = s.startDate + 'T00:00:00.000Z';
      const to = endOfDay(s.endDate);
      const completed = flow
        .filter((i) => committedIds.has(i.id) || i.sprintId === s.id)
        .filter((i) => doneWithin(byItem.get(i.id), from, to))
        .reduce((t, i) => t + points(i), 0);
      return { sprintId: s.id, sprint: s.name, committed, completed, inProgress: s.status === 'active' };
    });
}

/** Average completed points of the finished sprints in a velocity series (active ones excluded). */
export function averageVelocity(series: VelocityPoint[]): number {
  const done = series.filter((v) => !v.inProgress);
  return done.length ? round1(done.reduce((t, v) => t + v.completed, 0) / done.length) : 0;
}

// ---------------------------------------------------------------------------
// Burndown
// ---------------------------------------------------------------------------

export interface BurndownPoint {
  day: string;
  ideal: number;
  /** Null for days after `today`. */
  actual: number | null;
}

/** Working days (Mon–Fri) from start to end inclusive. Falls back to calendar days if none. */
export function sprintDays(startDate: string, endDate: string): string[] {
  const all: string[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) all.push(d);
  const work = all.filter((d) => {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    return dow !== 0 && dow !== 6;
  });
  return work.length ? work : all;
}

/**
 * Remaining points per working day of the sprint: the ideal straight line from the total scope to
 * zero, and the actual points not yet Done/Accepted at the end of each day up to `today`.
 * Scope = the items now in the sprint plus any committed ones (so carried-over work still counts).
 */
export function burndown(
  sprint: Sprint,
  items: MetricItem[],
  history: StatusChange[],
  today: string,
  commitment?: SprintCommitment,
): { total: number; points: BurndownPoint[] } {
  const byItem = historyByItem(history);
  const ids = new Set(commitment?.itemIds ?? []);
  const scope = items.filter(isFlowItem).filter((i) => i.sprintId === sprint.id || ids.has(i.id));
  const days = sprintDays(sprint.startDate, sprint.endDate);
  const total = scope.reduce((t, i) => t + points(i), 0);
  const steps = Math.max(1, days.length - 1);
  return {
    total,
    points: days.map((day, k) => ({
      day,
      ideal: round1(total - (total * k) / steps),
      actual:
        day > today
          ? null
          : scope
              .filter((i) => !isDone(statusAt(i, byItem.get(i.id), endOfDay(day)) ?? 'backlog'))
              .reduce((t, i) => t + points(i), 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cumulative flow
// ---------------------------------------------------------------------------

export type FlowDay = { day: string } & Record<ItemStatus, number>;

/** Count of items in each status at the end of each of the last `days` days up to `today`. */
export function cumulativeFlow(
  items: MetricItem[],
  history: StatusChange[],
  today: string,
  days = 30,
): FlowDay[] {
  const byItem = historyByItem(history);
  const flow = items.filter(isFlowItem);
  const out: FlowDay[] = [];
  for (let k = days - 1; k >= 0; k--) {
    const day = addDays(today, -k);
    const row = { day, ...Object.fromEntries(FLOW_STATUSES.map((s) => [s, 0])) } as FlowDay;
    for (const i of flow) {
      const s = statusAt(i, byItem.get(i.id), endOfDay(day));
      if (s) row[s]++;
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cycle time
// ---------------------------------------------------------------------------

export interface CycleTimePoint {
  itemId: string;
  key: string;
  title: string;
  startedAt: string;
  doneAt: string;
  /** Elapsed calendar days, one decimal. */
  days: number;
}

/**
 * Cycle time per finished item: from its first move into In Progress to the first Done/Accepted
 * after that. Items that skipped In Progress, or are not finished, are left out.
 */
export function cycleTimes(items: MetricItem[], history: StatusChange[]): CycleTimePoint[] {
  const byItem = historyByItem(history);
  const out: CycleTimePoint[] = [];
  for (const i of items.filter(isFlowItem)) {
    const changes = byItem.get(i.id) ?? [];
    const start = changes.find((c) => c.to === 'in_progress');
    if (!start) continue;
    const done = changes.find((c) => c.at >= start.at && isDone(c.to) && !isDone(c.from));
    if (!done) continue;
    out.push({
      itemId: i.id,
      key: i.key,
      title: i.title,
      startedAt: start.at,
      doneAt: done.at,
      days: round1((new Date(done.at).getTime() - new Date(start.at).getTime()) / DAY_MS),
    });
  }
  return out.sort((a, b) => a.doneAt.localeCompare(b.doneAt));
}

/** Nearest-rank percentile (p in 0–100). Returns 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

export interface ThroughputWeek {
  weekStart: string;
  count: number;
}

/**
 * Items finished per ISO week (Monday start) for the last `weeks` weeks up to `today`.
 * Every move from an unfinished status into Done or Accepted counts once.
 */
export function throughput(
  items: MetricItem[],
  history: StatusChange[],
  today: string,
  weeks = 10,
): ThroughputWeek[] {
  const flowIds = new Set(items.filter(isFlowItem).map((i) => i.id));
  const last = weekStart(today);
  const out: ThroughputWeek[] = [];
  for (let k = weeks - 1; k >= 0; k--) out.push({ weekStart: addDays(last, -7 * k), count: 0 });
  for (const c of history) {
    if (!flowIds.has(c.itemId) || !isDone(c.to) || isDone(c.from)) continue;
    const w = out.find((x) => x.weekStart === weekStart(isoDay(c.at)));
    if (w) w.count++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bundle served by GET /api/projects/[key]/metrics
// ---------------------------------------------------------------------------

export interface ProjectMetrics {
  today: string;
  velocity: VelocityPoint[];
  averageVelocity: number;
  burndown: { sprintId: string; sprint: string; total: number; points: BurndownPoint[] } | null;
  cumulativeFlow: FlowDay[];
  cycleTime: { points: CycleTimePoint[]; p50: number; p85: number };
  throughput: ThroughputWeek[];
}

export function projectMetrics(input: {
  sprints: Sprint[];
  items: MetricItem[];
  history: StatusChange[];
  commitments: SprintCommitment[];
  today: string;
}): ProjectMetrics {
  const { sprints, items, history, commitments, today } = input;
  const v = velocity(sprints, items, history, commitments);
  const active = sprints.find((s) => s.status === 'active');
  const cycle = cycleTimes(items, history);
  const days = cycle.map((c) => c.days);
  return {
    today,
    velocity: v,
    averageVelocity: averageVelocity(v),
    burndown: active
      ? {
          sprintId: active.id,
          sprint: active.name,
          ...burndown(
            active,
            items,
            history,
            today,
            commitments.find((c) => c.sprintId === active.id),
          ),
        }
      : null,
    cumulativeFlow: cumulativeFlow(items, history, today),
    cycleTime: { points: cycle, p50: percentile(days, 50), p85: percentile(days, 85) },
    throughput: throughput(items, history, today),
  };
}
