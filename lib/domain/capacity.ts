import type { Profile, Project, ProjectMember, Role } from './types';
import { isClientRole } from './permissions';

/**
 * Resource and bench capacity (CLAUDE.md 3.8): people directory, the person × ISO-week allocation
 * grid, project staffing and the U.S.-person rule for restricted projects. Pure rules only; the
 * stores live in lib/data/capacity.ts (demo) and lib/data/capacity-postgres.ts (Postgres + RLS).
 */

export const GRID_WEEKS = 12;
/** Above this share of weekly capacity a cell turns amber; above 100 it turns red. */
export const AMBER_ABOVE = 80;
export const RED_ABOVE = 100;
export const DEFAULT_HOURS_PER_WEEK = 40;

export type LoadLevel = 'ok' | 'amber' | 'red';

/** One weekly allocation row: hours of `userId` on `projectId` in the ISO week starting `week` (Monday). */
export interface Allocation {
  id: string;
  projectId: string;
  userId: string;
  week: string;
  hours: number;
}

/** Directory-only profile fields that the core Profile does not carry. */
export interface PersonExtras {
  certifications: string[];
  location?: string;
}

export interface CapacityState {
  allocations: Allocation[];
  extras: Record<string, PersonExtras>;
}

// ---------------------------------------------------------------------------
// ISO weeks (UTC, YYYY-MM-DD Mondays)
// ---------------------------------------------------------------------------
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);

/** The Monday (UTC) of the ISO week containing `d`, as YYYY-MM-DD. */
export function isoWeekStart(d: Date | string): string {
  const t =
    typeof d === 'string'
      ? parse(d)
      : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  return ymd(new Date(t.getTime() - dow * DAY));
}

export const addWeeks = (week: string, n: number) => ymd(new Date(parse(week).getTime() + n * 7 * DAY));

/** `n` consecutive ISO-week Mondays starting with the week containing `now`. */
export function nextWeeks(now: Date, n = GRID_WEEKS): string[] {
  const first = isoWeekStart(now);
  return Array.from({ length: n }, (_, i) => addWeeks(first, i));
}

export const isMonday = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoWeekStart(s) === s;

/** ISO week number and year of a Monday, e.g. { year: 2026, week: 42 }. */
export function isoWeekNumber(week: string): { year: number; week: number } {
  const d = parse(week);
  const thursday = new Date(d.getTime() + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = parse(isoWeekStart(jan4));
  return {
    year,
    week: Math.round((parse(isoWeekStart(d)).getTime() - firstMonday.getTime()) / (7 * DAY)) + 1,
  };
}

export const weekLabel = (week: string) => `W${String(isoWeekNumber(week).week).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------
export const capacityOf = (p: Pick<Profile, 'hoursPerWeek'>) =>
  p.hoursPerWeek && p.hoursPerWeek > 0 ? p.hoursPerWeek : DEFAULT_HOURS_PER_WEEK;

/** Percentage of weekly capacity, rounded to a whole number. Zero capacity with hours is 999%. */
export function loadPct(hours: number, capacity: number): number {
  if (hours <= 0) return 0;
  if (capacity <= 0) return 999;
  return Math.round((hours / capacity) * 100);
}

/** Amber above 80%, red above 100%. */
export function loadLevel(pct: number): LoadLevel {
  if (pct > RED_ABOVE) return 'red';
  if (pct > AMBER_ABOVE) return 'amber';
  return 'ok';
}

export const LOAD_LABEL: Record<LoadLevel, string> = {
  ok: 'Within capacity',
  amber: 'Near capacity',
  red: 'Over capacity',
};

export interface CellLoad {
  hours: number;
  pct: number;
  level: LoadLevel;
}

export function cellLoad(hours: number, capacity: number): CellLoad {
  const h = Math.round(hours * 100) / 100;
  const pct = loadPct(h, capacity);
  return { hours: h, pct, level: loadLevel(pct) };
}

/** Hours per week for a share of a person's capacity (e.g. 40 h × 60% = 24 h), to 2 decimals. */
export const hoursForPct = (capacity: number, pct: number) => Math.round(capacity * pct) / 100;

/**
 * Default weekly allocations when someone is assigned to a project at `pct`: capacity × pct in
 * every week of `weeks` that overlaps the project window (start..target), so the 12-week view caps it.
 */
export function defaultAllocations(
  capacity: number,
  pct: number,
  window: { startDate?: string; targetDate?: string },
  weeks: string[],
): { week: string; hours: number }[] {
  const hours = hoursForPct(capacity, pct);
  if (hours <= 0) return [];
  const from = window.startDate ? isoWeekStart(window.startDate) : null;
  const to = window.targetDate ? isoWeekStart(window.targetDate) : null;
  return weeks.filter((w) => (!from || w >= from) && (!to || w <= to)).map((week) => ({ week, hours }));
}

export interface WeekWarning {
  week: string;
  hours: number;
  pct: number;
  level: Exclude<LoadLevel, 'ok'>;
}

/**
 * KH-35: the weeks where assigning `newHours` (replacing any current hours on this project)
 * would push the person above 80% / 100%. `otherHours` = hours on every other project per week.
 */
export function assignmentWarnings(
  capacity: number,
  weeks: { week: string; otherHours: number; newHours: number }[],
): WeekWarning[] {
  const out: WeekWarning[] = [];
  for (const w of weeks) {
    const load = cellLoad(w.otherHours + w.newHours, capacity);
    if (load.level !== 'ok') out.push({ week: w.week, hours: load.hours, pct: load.pct, level: load.level });
  }
  return out;
}

/** One-line summary for the staffing dialog, or null when every week stays within 80%. */
export function warningSummary(name: string, warnings: WeekWarning[]): string | null {
  if (!warnings.length) return null;
  const worst = warnings.reduce((a, b) => (b.pct > a.pct ? b : a));
  const reds = warnings.filter((w) => w.level === 'red').length;
  const what =
    reds > 0
      ? `over 100% of capacity in ${reds} week${reds === 1 ? '' : 's'}`
      : `above 80% of capacity in ${warnings.length} week${warnings.length === 1 ? '' : 's'}`;
  return `${name} would be ${what} (peak ${worst.pct}% in ${weekLabel(worst.week)}).`;
}

// ---------------------------------------------------------------------------
// Restricted projects (SEC-02)
// ---------------------------------------------------------------------------
export const RESTRICTED_REFUSED = 'security.restricted_refused';

/** The refusal message for assigning `person` to `project`, or null when allowed. Mirrors 0011 SQL. */
export function restrictedRefusal(
  project: Pick<Project, 'key' | 'restricted'>,
  person: Pick<Profile, 'name' | 'usPerson'> | undefined,
): string | null {
  if (!person || !project.restricted || person.usPerson) return null;
  return `${person.name} is not a U.S. person and cannot be assigned to restricted project ${project.key}.`;
}

/** The message when a project cannot be flipped to restricted because of these people. */
export function restrictFlipRefusal(projectKey: string, names: string[]): string | null {
  if (!names.length) return null;
  return `Cannot mark ${projectKey} restricted: remove these non-U.S. people first: ${[...names].sort().join(', ')}.`;
}

/** Non-U.S. people currently on the project (members, item assignees, allocations). */
export function nonUsPeopleOn(
  projectId: string,
  people: Pick<Profile, 'id' | 'name' | 'usPerson'>[],
  sources: {
    members: Pick<ProjectMember, 'projectId' | 'userId'>[];
    assigneeIds: string[];
    allocationUserIds: string[];
  },
): string[] {
  const ids = new Set([
    ...sources.members.filter((m) => m.projectId === projectId).map((m) => m.userId),
    ...sources.assigneeIds,
    ...sources.allocationUserIds,
  ]);
  return people.filter((p) => ids.has(p.id) && !p.usPerson).map((p) => p.name);
}

/** The message when an Admin clears the U.S.-person flag of someone on restricted projects. */
export function usFlagRefusal(name: string, restrictedKeys: string[]): string | null {
  if (!restrictedKeys.length) return null;
  return `${name} is on restricted projects (${[...restrictedKeys].sort().join(', ')}); remove them first.`;
}

// ---------------------------------------------------------------------------
// Directory permissions (PPL-01)
// ---------------------------------------------------------------------------
type Viewer = Pick<Profile, 'role'>;

/** Clients never reach the directory (the internal layout redirects them; the API answers 403). */
export const canViewDirectory = (v: Viewer) => !isClientRole(v.role);
/** Associates get names and skills only: no US flag, allocation, availability or rates. */
export const canSeeDirectoryDetails = (v: Viewer) =>
  v.role === 'admin' || v.role === 'delivery_lead' || v.role === 'team_member';
export const canSeeUsFlag = (v: Viewer) => v.role === 'admin' || v.role === 'delivery_lead';
export const canSeeRates = (v: Viewer) => v.role === 'admin';
/** The allocation grid: Admins, Leads and Team Members read it; associates and clients do not. */
export const canViewGrid = canSeeDirectoryDetails;

export type PersonField =
  'title' | 'skills' | 'certifications' | 'location' | 'timezone' | 'hoursPerWeek' | 'usPerson' | 'costRate';

const LEAD_FIELDS: PersonField[] = ['skills', 'certifications'];
const ALL_FIELDS: PersonField[] = [
  'title',
  'skills',
  'certifications',
  'location',
  'timezone',
  'hoursPerWeek',
  'usPerson',
  'costRate',
];

/** Fields this viewer may edit on someone's directory entry. Admins edit all; Leads skills and certs. */
export function editableFields(v: Viewer): PersonField[] {
  if (v.role === 'admin') return ALL_FIELDS;
  if (v.role === 'delivery_lead') return LEAD_FIELDS;
  return [];
}

/** Rejects a patch that touches a field the viewer may not edit; returns the offending field. */
export function forbiddenField(v: Viewer, patch: Partial<Record<PersonField, unknown>>): PersonField | null {
  const ok = new Set(editableFields(v));
  return (Object.keys(patch) as PersonField[]).find((k) => patch[k] !== undefined && !ok.has(k)) ?? null;
}

export interface DirectoryEntry {
  id: string;
  name: string;
  skills: string[];
  role?: Role;
  title?: string;
  email?: string;
  certifications?: string[];
  location?: string;
  timezone?: string;
  hoursPerWeek?: number;
  /** Only for Admins and Leads. */
  usPerson?: boolean;
  /** This ISO week's allocated hours as % of capacity. Not for associates. */
  allocationPct?: number;
  /** Admin only. */
  costRate?: number;
}

/** Builds the directory entry the viewer is allowed to receive. Never adds fields it may not see. */
export function directoryEntry(
  viewer: Viewer,
  p: Profile,
  extras: PersonExtras | undefined,
  allocationPct: number,
): DirectoryEntry {
  const base: DirectoryEntry = { id: p.id, name: p.name, skills: p.skills ?? [] };
  if (!canSeeDirectoryDetails(viewer)) return base;
  const e: DirectoryEntry = {
    ...base,
    role: p.role,
    title: p.title,
    email: p.email,
    certifications: extras?.certifications ?? [],
    location: extras?.location,
    timezone: p.timezone,
    hoursPerWeek: capacityOf(p),
    allocationPct,
  };
  if (canSeeUsFlag(viewer)) e.usPerson = p.usPerson;
  if (canSeeRates(viewer) && p.costRate != null) e.costRate = p.costRate;
  return e;
}

/** Directory search and filters (client side). */
export function filterDirectory(
  list: DirectoryEntry[],
  f: { q?: string; skill?: string; role?: string },
): DirectoryEntry[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter(
    (p) =>
      (!f.skill || p.skills.includes(f.skill) || (p.certifications ?? []).includes(f.skill)) &&
      (!f.role || p.role === f.role) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q) ||
        p.skills.some((s) => s.toLowerCase().includes(q)) ||
        (p.certifications ?? []).some((s) => s.toLowerCase().includes(q))),
  );
}

/** Tags are trimmed, de-duplicated and non-empty. */
export const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim()).filter(Boolean))];

// ---------------------------------------------------------------------------
// Grid view model
// ---------------------------------------------------------------------------
export interface GridProjectHours {
  projectId: string;
  projectKey: string;
  hours: number;
  /** The viewer manages this project (inline edit allowed). */
  editable: boolean;
}

export interface GridCell extends CellLoad {
  week: string;
  projects: GridProjectHours[];
  /** Hours on projects the viewer cannot see, aggregated without names. */
  otherHours: number;
}

export interface GridRow {
  /** `memberOf`: ids of the visible projects this person is staffed on. */
  person: { id: string; name: string; title?: string; hoursPerWeek: number; memberOf: string[] };
  cells: GridCell[];
}

export interface CapacityGrid {
  weeks: string[];
  projects: { id: string; key: string; name: string; editable: boolean }[];
  rows: GridRow[];
}

/** Assembles grid rows from visible allocations plus aggregated hidden hours. */
export function buildGrid(input: {
  weeks: string[];
  people: Profile[];
  projects: { id: string; key: string; name: string; editable: boolean }[];
  members: Pick<ProjectMember, 'projectId' | 'userId'>[];
  allocations: Pick<Allocation, 'projectId' | 'userId' | 'week' | 'hours'>[];
  /** Hours per person and week on ALL projects (visible or not); the rest is shown as "other". */
  totals: { userId: string; week: string; hours: number }[];
}): CapacityGrid {
  const proj = new Map(input.projects.map((p) => [p.id, p]));
  const rows = input.people.map((person): GridRow => {
    const cap = capacityOf(person);
    const cells = input.weeks.map((week): GridCell => {
      const projects = input.allocations
        .filter((a) => a.userId === person.id && a.week === week && proj.has(a.projectId) && a.hours > 0)
        .map((a) => ({
          projectId: a.projectId,
          projectKey: proj.get(a.projectId)!.key,
          hours: a.hours,
          editable: proj.get(a.projectId)!.editable,
        }))
        .sort((a, b) => a.projectKey.localeCompare(b.projectKey));
      const visible = projects.reduce((s, p) => s + p.hours, 0);
      const total = input.totals.find((t) => t.userId === person.id && t.week === week)?.hours ?? 0;
      const otherHours = Math.max(0, Math.round((total - visible) * 100) / 100);
      return { week, projects, otherHours, ...cellLoad(visible + otherHours, cap) };
    });
    const memberOf = [
      ...new Set(
        input.members.filter((m) => m.userId === person.id && proj.has(m.projectId)).map((m) => m.projectId),
      ),
    ];
    return {
      person: { id: person.id, name: person.name, title: person.title, hoursPerWeek: cap, memberOf },
      cells,
    };
  });
  return { weeks: input.weeks, projects: input.projects, rows };
}
