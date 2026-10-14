/**
 * Pure date-layout math for the Gantt-style timeline. No React, no DOM: everything here is
 * unit-tested in layout.test.ts. Dates are ISO `YYYY-MM-DD` strings, treated as whole UTC days;
 * a span's `end` is inclusive (a one-day bar starts and ends on the same date).
 */
import type { ItemType, Phase, Sprint } from '@/lib/domain/types';

export type Zoom = 'week' | 'month' | 'quarter';
export const ZOOMS: { id: Zoom; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
];
export const PX_PER_DAY: Record<Zoom, number> = { week: 28, month: 8, quarter: 3 };

/** Vertical rhythm, shared by the SVG and the HTML label column so rows line up. */
export const AXIS_H = 32;
export const PHASE_ROW_H = 44;
export const MILESTONE_ROW_H = 32;
export const ROW_H = 36;
export const BAR_H = 20;
export const HEADER_H = AXIS_H + PHASE_ROW_H + MILESTONE_ROW_H;

const DAY_MS = 86_400_000;
export const toDay = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`) / DAY_MS);
export const fromDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const shiftIso = (iso: string, days: number) => fromDay(toDay(iso) + days);
export const daysBetween = (a: string, b: string) => toDay(b) - toDay(a);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Locale-independent, e.g. "5 Oct 2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export interface Span {
  start: string;
  end: string;
}

export function shiftSpan(span: Span, days: number): Span {
  return { start: shiftIso(span.start, days), end: shiftIso(span.end, days) };
}

/** Horizontal drag distance → whole days (snap to days). */
export const dragDays = (dx: number, zoom: Zoom) => Math.round(dx / PX_PER_DAY[zoom]) || 0;

// ---------------------------------------------------------------------------
// Phases and gates
// ---------------------------------------------------------------------------

export interface PhaseSpan extends Span {
  id: string;
  gate: number;
  name: string;
  status: Phase['status'];
  /** True when the dates came from the even split of the project dates. */
  derived: boolean;
}

/**
 * Phase dates come from the phase when both are set; otherwise the project's start → target
 * range is split evenly across the five gates and the phase takes its share.
 */
export function phaseSpans(project: { startDate: string; targetDate: string }, phases: Phase[]): PhaseSpan[] {
  const sorted = [...phases].sort((a, b) => a.gate - b.gate);
  const s = toDay(project.startDate);
  const total = Math.max(toDay(project.targetDate) - s + 1, sorted.length || 1);
  const n = 5;
  return sorted.map((p) => {
    const i = p.gate - 1;
    const own = p.startDate && p.endDate && p.endDate >= p.startDate;
    return {
      id: p.id,
      gate: p.gate,
      name: p.name,
      status: p.status,
      derived: !own,
      start: own ? p.startDate! : fromDay(s + Math.floor((i * total) / n)),
      end: own ? p.endDate! : fromDay(s + Math.floor(((i + 1) * total) / n) - 1),
    };
  });
}

export const isGatePassed = (status: Phase['status']) =>
  status === 'approved' || status === 'approved_with_conditions';

// ---------------------------------------------------------------------------
// Epics
// ---------------------------------------------------------------------------

export interface TimelineItemLike {
  id: string;
  key: string;
  title: string;
  type: ItemType;
  status: string;
  parentId?: string | null;
  sprintId?: string | null;
  phaseId?: string | null;
  dueDate?: string | null;
}

export interface ScheduleLike {
  itemId: string;
  startDate: string;
  endDate: string;
}

export type EpicSpanSource = 'schedule' | 'children' | 'phase' | 'project';

/**
 * An epic spans the min/max of its descendants' sprint dates and due dates. An explicit schedule
 * (set by dragging the bar) wins; with no dated children it falls back to its phase, then the project.
 */
export function epicSpan(
  epic: TimelineItemLike,
  items: TimelineItemLike[],
  sprints: Pick<Sprint, 'id' | 'startDate' | 'endDate'>[],
  schedules: ScheduleLike[],
  phases: PhaseSpan[],
  project: { startDate: string; targetDate: string },
): Span & { source: EpicSpanSource } {
  const sched = schedules.find((x) => x.itemId === epic.id);
  if (sched) return { start: sched.startDate, end: sched.endDate, source: 'schedule' };

  const children = new Map<string, TimelineItemLike[]>();
  for (const i of items) if (i.parentId) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const sprintById = new Map(sprints.map((s) => [s.id, s]));
  const dates: string[] = [];
  const seen = new Set<string>([epic.id]);
  const queue = [...(children.get(epic.id) ?? [])];
  while (queue.length) {
    const c = queue.shift()!;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const sp = c.sprintId ? sprintById.get(c.sprintId) : undefined;
    if (sp) dates.push(sp.startDate, sp.endDate);
    if (c.dueDate) dates.push(c.dueDate.slice(0, 10));
    queue.push(...(children.get(c.id) ?? []));
  }
  if (dates.length) {
    dates.sort();
    return { start: dates[0], end: dates[dates.length - 1], source: 'children' };
  }
  const phase = phases.find((p) => p.id === epic.phaseId);
  if (phase) return { start: phase.start, end: phase.end, source: 'phase' };
  return { start: project.startDate, end: project.targetDate, source: 'project' };
}

// ---------------------------------------------------------------------------
// Full model
// ---------------------------------------------------------------------------

export interface TimelineInput {
  project: { key: string; name: string; startDate: string; targetDate: string };
  phases: Phase[];
  sprints: Sprint[];
  items: TimelineItemLike[];
  links: { id: string; fromId: string; toId: string; type: string }[];
  schedules: ScheduleLike[];
}

export interface Bar extends Span {
  id: string;
  kind: 'sprint' | 'epic';
  label: string;
  /** Item key for epics. */
  key?: string;
  status: string;
  source?: EpicSpanSource;
  row: number;
  x: number;
  y: number;
  w: number;
}

export interface Tick {
  date: string;
  x: number;
  label: string;
}

export interface Milestone {
  id: string;
  kind: 'sprint_end' | 'target';
  label: string;
  date: string;
  x: number;
}

export interface Gate {
  phaseId: string;
  gate: number;
  name: string;
  date: string;
  passed: boolean;
  x: number;
}

export interface Arrow {
  id: string;
  fromId: string;
  toId: string;
  path: string;
}

export interface TimelineModel {
  start: string;
  end: string;
  pxPerDay: number;
  width: number;
  height: number;
  phases: (PhaseSpan & { x: number; w: number; passed: boolean })[];
  gates: Gate[];
  bars: Bar[];
  milestones: Milestone[];
  arrows: Arrow[];
  ticks: Tick[];
  today: { date: string; x: number } | null;
}

/** Start of the zoom's natural period containing `iso` (Monday, 1st of month, quarter start). */
export function periodStart(iso: string, zoom: Zoom): string {
  const d = toDay(iso);
  if (zoom === 'week') {
    const dow = (new Date(d * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
    return fromDay(d - dow);
  }
  const [y, m] = iso.split('-').map(Number);
  const month = zoom === 'quarter' ? Math.floor((m - 1) / 3) * 3 + 1 : m;
  return `${y}-${String(month).padStart(2, '0')}-01`;
}

function nextPeriod(iso: string, zoom: Zoom): string {
  if (zoom === 'week') return shiftIso(iso, 7);
  const [y, m] = iso.split('-').map(Number);
  const step = zoom === 'quarter' ? 3 : 1;
  const mm = m - 1 + step;
  return `${y + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}-01`;
}

function tickLabel(iso: string, zoom: Zoom): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (zoom === 'week') return `${d} ${MONTHS[m - 1]}`;
  if (zoom === 'month') return `${MONTHS[m - 1]} ${y}`;
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

export function ticks(start: string, end: string, zoom: Zoom, ppd = PX_PER_DAY[zoom]): Tick[] {
  const out: Tick[] = [];
  const s = toDay(start);
  for (let t = periodStart(start, zoom); t <= end; t = nextPeriod(t, zoom))
    if (t >= start) out.push({ date: t, x: (toDay(t) - s) * ppd, label: tickLabel(t, zoom) });
  return out;
}

/** Elbow connector from the end of one bar to the start of another (arrowhead drawn by a marker). */
export function arrowPath(from: Bar, to: Bar): string {
  const x1 = from.x + from.w;
  const y1 = from.y + BAR_H / 2;
  const x2 = to.x;
  const y2 = to.y + BAR_H / 2;
  if (x2 - x1 >= 16) return `M ${x1} ${y1} H ${x1 + 8} V ${y2} H ${x2}`;
  const midY = y2 > y1 ? to.y - (ROW_H - BAR_H) / 2 : to.y + BAR_H + (ROW_H - BAR_H) / 2;
  return `M ${x1} ${y1} H ${x1 + 8} V ${midY} H ${x2 - 8} V ${y2} H ${x2}`;
}

export function buildTimeline(input: TimelineInput, zoom: Zoom, today: string): TimelineModel {
  const ppd = PX_PER_DAY[zoom];
  const phases = phaseSpans(input.project, input.phases);
  const epics = input.items.filter((i) => i.type === 'epic');
  const epicSpans = epics.map((e) => ({
    epic: e,
    span: epicSpan(e, input.items, input.sprints, input.schedules, phases, input.project),
  }));
  const sprints = [...input.sprints].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name),
  );

  const starts = [
    input.project.startDate,
    today,
    ...phases.map((p) => p.start),
    ...sprints.map((s) => s.startDate),
    ...epicSpans.map((e) => e.span.start),
  ];
  const ends = [
    input.project.targetDate,
    today,
    ...phases.map((p) => p.end),
    ...sprints.map((s) => s.endDate),
    ...epicSpans.map((e) => e.span.end),
  ];
  const start = periodStart(shiftIso(starts.sort()[0], -3), zoom);
  const end = shiftIso(ends.sort()[ends.length - 1], 14);
  const s0 = toDay(start);
  const x = (iso: string) => (toDay(iso) - s0) * ppd;
  const w = (sp: Span) => (toDay(sp.end) - toDay(sp.start) + 1) * ppd;
  const width = (toDay(end) - s0 + 1) * ppd;

  const bars: Bar[] = [];
  const rowY = (row: number) => HEADER_H + row * ROW_H + (ROW_H - BAR_H) / 2;
  sprints.forEach((sp) => {
    const row = bars.length;
    const span = { start: sp.startDate, end: sp.endDate };
    bars.push({
      id: sp.id,
      kind: 'sprint',
      label: sp.name,
      status: sp.status,
      ...span,
      row,
      x: x(span.start),
      y: rowY(row),
      w: w(span),
    });
  });
  epicSpans.forEach(({ epic, span }) => {
    const row = bars.length;
    bars.push({
      id: epic.id,
      kind: 'epic',
      label: epic.title,
      key: epic.key,
      status: epic.status,
      start: span.start,
      end: span.end,
      source: span.source,
      row,
      x: x(span.start),
      y: rowY(row),
      w: w(span),
    });
  });

  const barById = new Map(bars.map((b) => [b.id, b]));
  const arrows: Arrow[] = input.links
    .filter((l) => l.type === 'blocks' && barById.has(l.fromId) && barById.has(l.toId))
    .map((l) => ({
      id: l.id,
      fromId: l.fromId,
      toId: l.toId,
      path: arrowPath(barById.get(l.fromId)!, barById.get(l.toId)!),
    }));

  const milestones: Milestone[] = [
    ...sprints.map((sp) => ({
      id: `ms_${sp.id}`,
      kind: 'sprint_end' as const,
      label: `${sp.name} ends`,
      date: sp.endDate,
      x: x(sp.endDate) + ppd,
    })),
    {
      id: 'ms_target',
      kind: 'target' as const,
      label: 'Target date',
      date: input.project.targetDate,
      x: x(input.project.targetDate) + ppd,
    },
  ];

  const placedPhases = phases.map((p) => ({ ...p, x: x(p.start), w: w(p), passed: isGatePassed(p.status) }));
  const gates: Gate[] = placedPhases.map((p) => ({
    phaseId: p.id,
    gate: p.gate,
    name: p.name,
    date: p.end,
    passed: p.passed,
    x: p.x + p.w,
  }));

  return {
    start,
    end,
    pxPerDay: ppd,
    width,
    height: HEADER_H + Math.max(bars.length, 1) * ROW_H + 8,
    phases: placedPhases,
    gates,
    bars,
    milestones,
    arrows,
    ticks: ticks(start, end, zoom, ppd),
    today: today >= start && today <= end ? { date: today, x: x(today) + ppd / 2 } : null,
  };
}

/** Screen-reader description of a bar. `float` (days) is announced when critical-path analysis is on. */
export function barAriaLabel(
  bar: Bar,
  opts: { editable: boolean; critical?: boolean; float?: number },
): string {
  const what = bar.kind === 'sprint' ? 'Sprint' : `Epic ${bar.key}`;
  const status = bar.status.replace(/_/g, ' ');
  const base = `${what}: ${bar.label}, ${status}, ${formatDate(bar.start)} to ${formatDate(bar.end)}`;
  const float = opts.float === undefined ? '' : `, ${floatLabel(opts.float)}`;
  const crit = opts.critical ? ', on the critical path' : '';
  return opts.editable
    ? `${base}${float}${crit}. Use Left and Right arrow keys to move by one day.`
    : `${base}${float}${crit}.`;
}

export const floatLabel = (days: number) => `float ${days} ${days === 1 ? 'day' : 'days'}`;

// ---------------------------------------------------------------------------
// Critical path extension point
// ---------------------------------------------------------------------------

/** Which part of the network the critical path is computed over: the Execute phase (gate 3) or all. */
export type CriticalScope = 'execute' | 'all';

export interface CriticalPathResult {
  /** Ids of bars on the critical path. */
  bars: ReadonlySet<string>;
  /** Ids of dependency arrows (link ids) that drive the critical path. */
  arrows: ReadonlySet<string>;
  /** Total float in days for every analysed bar. */
  float: ReadonlyMap<string, number>;
  /** Dependency cycles, as lists of human-readable labels (item keys). */
  cycles: string[][];
  /** Labels of the critical bars, in path order. */
  chain: string[];
  /** Early finish of the analysed network (inclusive ISO date), when there is one. */
  finish?: string;
}

/**
 * Extension point for critical-path highlighting: a function from the laid-out model and its input
 * to the bars and arrows on the critical path (see `features/timeline/critical.ts`).
 */
export type CriticalPathFn = (
  model: TimelineModel,
  input: TimelineInput,
  opts: { scope: CriticalScope },
) => CriticalPathResult;

export const EMPTY_CRITICAL_PATH: CriticalPathResult = {
  bars: new Set(),
  arrows: new Set(),
  float: new Map(),
  cycles: [],
  chain: [],
};
export const noCriticalPath: CriticalPathFn = () => EMPTY_CRITICAL_PATH;
