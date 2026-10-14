import type { Profile, Project, Role } from './types';
import { canManageProject, canSeeCostRates, isInternalRole } from './permissions';
import type { ActualCost, Cents } from './evm';

/**
 * Time tracking (TIME-01, CLAUDE.md 3.9). Pure rules only: no I/O, no clock reads.
 *
 * Lifecycle: draft → submitted (the person submits their week) → approved | rejected (the project
 * Lead or an Admin decides; a rejection needs a reason). Rejected entries go back to the person,
 * who edits them (back to draft) and submits again. Approved entries are locked for everyone.
 */
export type TimeStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const TIME_STATUS_LABEL: Record<TimeStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

export interface TimeEntry {
  id: string;
  projectId: string;
  itemId: string | null;
  userId: string;
  /** YYYY-MM-DD */
  date: string;
  hours: number;
  billable: boolean;
  note: string;
  status: TimeStatus;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An entry as the API returns it: with the project, item and people resolved for display. */
export interface TimeEntryView extends TimeEntry {
  projectKey: string;
  itemKey: string | null;
  itemTitle: string | null;
  userName: string;
  decidedByName: string | null;
  /** Admin only (canSeeCostRates); undefined for everyone else. */
  costRate?: number | null;
  /** Admin only: hours × cost rate, integer cents. */
  costCents?: number | null;
}

export const HOURS_STEP = 0.25;
export const MAX_HOURS = 24;

/** Hours must be > 0, at most 24 and a multiple of a quarter hour. Returns an error message or null. */
export function hoursError(hours: number): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return 'Hours must be more than 0.';
  if (hours > MAX_HOURS) return 'Hours cannot be more than 24 in one entry.';
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) return 'Log time in quarter hours (0.25 steps).';
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date in YYYY-MM-DD form (rejects 2027-02-30). */
export function isIsoDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

const DAY = 86_400_000;
const toDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromDay(toDay(d) + n * DAY);

/** Monday of the ISO week that contains `date` (YYYY-MM-DD). */
export function isoWeekStart(date: string): string {
  const dow = new Date(toDay(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The seven dates (Mon–Sun) of the ISO week starting `weekStart`. */
export const weekDays = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/** ISO week label, e.g. "2026-W42". */
export function isoWeekLabel(date: string): string {
  const monday = isoWeekStart(date);
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week = 1 + Math.round((toDay(monday) - toDay(isoWeekStart(jan4))) / (7 * DAY));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Only internal users log time (associates only where they are assigned: canSeeProject). */
export const canLogTime = (role: Role) => isInternalRole(role);
/** The project Lead or an Admin approves time on the project. */
export const canApproveTime = (user: Profile, project: Project) => canManageProject(user, project);
/** Approved-time export (invoicing): Admins and Delivery Leads. */
export const canExportTime = (user: Profile) => user.role === 'admin' || user.role === 'delivery_lead';
/** Cost rates and cost amounts are Admin only. Leads see hours, never cost. */
export const canSeeTimeCost = (user: Profile) => canSeeCostRates(user);

/** The owner edits or deletes their own entry while it is a draft or was rejected. */
export const isEditable = (e: Pick<TimeEntry, 'status'>) => e.status === 'draft' || e.status === 'rejected';

/** hours × rate ($/h) in integer cents. */
export const costCents = (hours: number, rate: number): Cents => Math.round(hours * rate * 100);

/**
 * Actual cost rule (EVM AC; used by lib/data/insight.ts actualCostFor):
 * - Every approved time entry costs hours × the person's cost rate, on its entry date.
 * - Seeded/imported actuals are kept only for dates BEFORE the project's first approved entry
 *   (the cutover). From the cutover on, AC comes from approved time alone, so the two sources
 *   never double count the same period.
 * - A project with no approved time keeps its seeded actuals unchanged.
 */
export function mergeActuals<T extends ActualCost>(seeded: T[], fromTime: ActualCost[]): ActualCost[] {
  if (!fromTime.length) return [...seeded].sort((a, b) => a.date.localeCompare(b.date));
  const cutover = fromTime.reduce((m, a) => (a.date < m ? a.date : m), fromTime[0].date);
  return [...seeded.filter((a) => a.date < cutover), ...fromTime].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

/** Approved entries as dated cost amounts (cents). Entries without a rate cost nothing. */
export function approvedTimeActuals(
  entries: Pick<TimeEntry, 'status' | 'date' | 'hours' | 'userId'>[],
  rateFor: (userId: string) => number | undefined | null,
): ActualCost[] {
  return entries
    .filter((e) => e.status === 'approved')
    .map((e) => ({ date: e.date, amountCents: costCents(e.hours, rateFor(e.userId) ?? 0) }));
}

export const sumHours = (entries: Pick<TimeEntry, 'hours'>[]) =>
  Math.round(entries.reduce((s, e) => s + e.hours, 0) * 100) / 100;

// ---------------------------------------------------------------------------
// Weekly timesheet grid
// ---------------------------------------------------------------------------
export interface TimesheetCell {
  date: string;
  hours: number;
  entries: TimeEntryView[];
}

export interface TimesheetRow {
  key: string;
  projectKey: string;
  itemId: string | null;
  itemKey: string | null;
  itemTitle: string | null;
  cells: TimesheetCell[];
  total: number;
}

export interface TimesheetGrid {
  weekStart: string;
  days: string[];
  rows: TimesheetRow[];
  dayTotals: number[];
  total: number;
}

/** Rows are item × day for the week; extra rows (items without time yet) can be added empty. */
export function timesheetGrid(
  entries: TimeEntryView[],
  weekStart: string,
  extraRows: Pick<TimesheetRow, 'projectKey' | 'itemId' | 'itemKey' | 'itemTitle'>[] = [],
): TimesheetGrid {
  const days = weekDays(weekStart);
  const inWeek = entries.filter((e) => e.date >= days[0] && e.date <= days[6]);
  const rows = new Map<string, TimesheetRow>();
  const ensure = (r: Pick<TimesheetRow, 'projectKey' | 'itemId' | 'itemKey' | 'itemTitle'>) => {
    const key = r.itemId ?? `project:${r.projectKey}`;
    if (!rows.has(key))
      rows.set(key, { key, ...r, cells: days.map((date) => ({ date, hours: 0, entries: [] })), total: 0 });
    return rows.get(key)!;
  };
  for (const e of inWeek) {
    const row = ensure(e);
    const cell = row.cells[days.indexOf(e.date)];
    cell.entries.push(e);
    cell.hours = sumHours(cell.entries);
  }
  for (const r of extraRows) ensure(r);
  const list = [...rows.values()].map((r) => ({ ...r, total: sumHours(r.cells.flatMap((c) => c.entries)) }));
  list.sort((a, b) => (a.itemKey ?? '').localeCompare(b.itemKey ?? '', 'en', { numeric: true }));
  return {
    weekStart,
    days,
    rows: list,
    dayTotals: days.map((_, i) => sumHours(list.flatMap((r) => r.cells[i].entries))),
    total: sumHours(inWeek),
  };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------
export interface ApprovalGroup {
  key: string;
  userId: string;
  userName: string;
  weekStart: string;
  week: string;
  entries: TimeEntryView[];
  hours: number;
}

/** Submitted entries grouped by person and ISO week, newest week first, then by name. */
export function groupApprovals(entries: TimeEntryView[]): ApprovalGroup[] {
  const groups = new Map<string, ApprovalGroup>();
  for (const e of entries) {
    const weekStart = isoWeekStart(e.date);
    const key = `${e.userId}:${weekStart}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        userId: e.userId,
        userName: e.userName,
        weekStart,
        week: isoWeekLabel(weekStart),
        entries: [],
        hours: 0,
      });
    groups.get(key)!.entries.push(e);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      entries: g.entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
      hours: sumHours(g.entries),
    }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.userName.localeCompare(b.userName));
}

/** A rejection needs a reason. Returns an error message or null. */
export const rejectReasonError = (decision: 'approved' | 'rejected', reason?: string | null) =>
  decision === 'rejected' && !reason?.trim() ? 'A reason is required to reject time.' : null;
