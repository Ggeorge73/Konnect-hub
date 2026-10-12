import type { ItemStatus, ItemType, Project, Sprint, WorkItem } from './types';

/** Default conversion used for capacity when a project estimates in story points. */
export const DEFAULT_HOURS_PER_POINT = 6;
/** Planned above 100% of available hours turns the capacity bar amber; above 120% red. */
export const CAPACITY_AMBER = 1;
export const CAPACITY_RED = 1.2;

/** Per-project planning settings (column `projects.hours_per_point`). */
export interface PlanningSettings {
  projectId: string;
  hoursPerPoint: number;
}

/** Explicit dates for an epic set by dragging its bar (columns `work_items.planned_start/planned_end`). */
export interface ItemSchedule {
  itemId: string;
  projectId: string;
  startDate: string;
  endDate: string;
}

/** Planning state held alongside the core Db in demo mode. */
export interface PlanningState {
  settings: PlanningSettings[];
  schedules: ItemSchedule[];
}

export type CarryOver = 'next' | 'backlog';

const CONTAINER_TYPES: ItemType[] = ['epic', 'feature'];
const FINISHED: ItemStatus[] = ['done', 'accepted'];

/** Epics and features are containers: they never sit in a sprint or the backlog list. */
export const isPlannable = (i: Pick<WorkItem, 'type'>) => !CONTAINER_TYPES.includes(i.type);
export const isUnfinished = (i: Pick<WorkItem, 'status'>) => !FINISHED.includes(i.status);

/** Sum of estimates in hours. Points are converted with the project's hours-per-point. */
export function plannedHours(
  items: Pick<WorkItem, 'type' | 'estimate'>[],
  unit: Project['estimateUnit'],
  hoursPerPoint = DEFAULT_HOURS_PER_POINT,
): number {
  const sum = items.filter(isPlannable).reduce((acc, i) => acc + (i.estimate ?? 0), 0);
  const hours = unit === 'points' ? sum * hoursPerPoint : sum;
  return Math.round(hours * 100) / 100;
}

export type CapacityLevel = 'none' | 'ok' | 'over' | 'critical';

export interface Capacity {
  planned: number;
  available: number | null;
  /** planned / available, or null when no capacity is set. */
  ratio: number | null;
  level: CapacityLevel;
  /** Always shown next to the bar so colour is never the only cue. */
  label: string;
}

export function capacity(planned: number, available: number | null | undefined): Capacity {
  if (!available || available <= 0)
    return {
      planned,
      available: null,
      ratio: null,
      level: 'none',
      label: `${fmt(planned)} h planned · no capacity set`,
    };
  const ratio = planned / available;
  const level: CapacityLevel = ratio > CAPACITY_RED ? 'critical' : ratio > CAPACITY_AMBER ? 'over' : 'ok';
  const pct = Math.round(ratio * 100);
  const status = level === 'critical' ? 'Overloaded' : level === 'over' ? 'Over capacity' : 'Within capacity';
  return {
    planned,
    available,
    ratio,
    level,
    label: `${fmt(planned)} of ${fmt(available)} h · ${pct}% · ${status}`,
  };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export interface SprintInput {
  name: string;
  phaseId: string;
  startDate: string;
  endDate: string;
  goal?: string;
  capacityHours?: number | null;
}

/** Returns a list of human-readable problems; empty when valid. */
export function validateSprint(input: Partial<SprintInput>): string[] {
  const errors: string[] = [];
  if (input.name !== undefined && !input.name.trim()) errors.push('Name is required.');
  if (input.startDate !== undefined && !isIsoDate(input.startDate)) errors.push('Start date is invalid.');
  if (input.endDate !== undefined && !isIsoDate(input.endDate)) errors.push('End date is invalid.');
  if (input.startDate && input.endDate && isIsoDate(input.startDate) && isIsoDate(input.endDate))
    if (input.endDate <= input.startDate) errors.push('End date must be after the start date.');
  if (input.capacityHours != null && (!Number.isFinite(input.capacityHours) || input.capacityHours < 0))
    errors.push('Capacity hours cannot be negative.');
  return errors;
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export type RuleResult = { ok: true } | { ok: false; reason: string };

/** Only one active sprint per project, and only planned sprints can start. */
export function canStartSprint(sprint: Sprint, all: Sprint[]): RuleResult {
  if (sprint.status !== 'planned')
    return {
      ok: false,
      reason: `${sprint.name} is ${sprint.status === 'active' ? 'already active' : 'completed'}.`,
    };
  const active = all.find(
    (s) => s.projectId === sprint.projectId && s.status === 'active' && s.id !== sprint.id,
  );
  if (active)
    return {
      ok: false,
      reason: `${active.name} is still active. Complete it before starting ${sprint.name}; a project runs one sprint at a time.`,
    };
  return { ok: true };
}

export function canCompleteSprint(sprint: Sprint): RuleResult {
  if (sprint.status !== 'active') return { ok: false, reason: `Only an active sprint can be completed.` };
  return { ok: true };
}

/** The earliest planned sprint in the same project, excluding `sprint` itself. */
export function nextPlannedSprint(sprint: Sprint, all: Sprint[]): Sprint | null {
  return (
    all
      .filter((s) => s.projectId === sprint.projectId && s.status === 'planned' && s.id !== sprint.id)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name))[0] ?? null
  );
}

export interface CompletionPlan {
  unfinished: WorkItem[];
  /** Destination sprint id, or null for the backlog. */
  targetSprintId: string | null;
  moves: { itemId: string; sprintId: string | null; position: number }[];
}

/**
 * Works out where unfinished items go when a sprint completes. Finished items stay in the
 * completed sprint (they count towards its velocity). Moved items are appended, in their
 * current order, after everything already in the destination list.
 */
export function planCompletion(
  sprint: Sprint,
  sprints: Sprint[],
  items: WorkItem[],
  choice: CarryOver,
): CompletionPlan | { error: string } {
  const rule = canCompleteSprint(sprint);
  if (!rule.ok) return { error: rule.reason };
  const unfinished = items
    .filter((i) => i.sprintId === sprint.id && !i.deletedAt && isPlannable(i) && isUnfinished(i))
    .sort((a, b) => a.position - b.position);
  let targetSprintId: string | null = null;
  if (choice === 'next') {
    const next = nextPlannedSprint(sprint, sprints);
    if (!next && unfinished.length)
      return { error: 'There is no planned sprint to move unfinished work into. Move it to the backlog.' };
    targetSprintId = next?.id ?? null;
  }
  const destination = items.filter(
    (i) =>
      i.projectId === sprint.projectId &&
      !i.deletedAt &&
      isPlannable(i) &&
      (i.sprintId ?? null) === targetSprintId &&
      i.sprintId !== sprint.id,
  );
  let pos = Math.max(0, ...destination.map((i) => i.position));
  const moves = unfinished.map((i) => ({ itemId: i.id, sprintId: targetSprintId, position: (pos += 1000) }));
  return { unfinished, targetSprintId, moves };
}

/** Default phase for a new sprint: the active phase, else the first not yet approved, else the last. */
export function defaultPhaseId<P extends { id: string; gate: number; status: string }>(
  phases: P[],
): string | undefined {
  const sorted = [...phases].sort((a, b) => a.gate - b.gate);
  return (
    sorted.find((p) => p.status === 'active')?.id ??
    sorted.find((p) => p.status !== 'approved' && p.status !== 'approved_with_conditions')?.id ??
    sorted[sorted.length - 1]?.id
  );
}

/** Suggested dates for the next sprint: the day after the latest sprint ends, two weeks long. */
export function suggestSprintDates(sprints: Sprint[], today: string): { startDate: string; endDate: string } {
  const last = [...sprints].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const start = last && last.endDate >= today ? addIsoDays(last.endDate, 1) : today;
  return { startDate: start, endDate: addIsoDays(start, 13) };
}

export function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
