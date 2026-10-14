import type { ItemStatus, Profile, Project, Sprint, Visibility, WorkItem } from './types';
import type { Deliverable } from './deliverables';
import type { StatusChange } from './metrics';
import { addDays, isDone, isoDay } from './metrics';
import { canEditItems, canManageProject, isInternalRole } from './permissions';

/**
 * AI assist (CLAUDE.md 3.13, KH-42..44). Pure rules only: no I/O, no clock reads, no model calls.
 * AI never writes directly: every feature returns a draft that a person accepts. It is off by
 * default on every project, and only the project's Delivery Lead or an Admin turns it on.
 */

export type AiFeature = 'status_report' | 'risk_suggestions' | 'meeting_notes' | 'thread_summary';

export const AI_FEATURE_LABEL: Record<AiFeature, string> = {
  status_report: 'Status report draft',
  risk_suggestions: 'Risk suggestions',
  meeting_notes: 'Meeting notes to work items',
  thread_summary: 'Thread summary',
};

/** Per-project switch. A project with no row is off. */
export interface AiSettings {
  projectId: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const AI_ENABLED_BY_DEFAULT = false;

export const settingsFor = (rows: AiSettings[], projectId: string): AiSettings =>
  rows.find((r) => r.projectId === projectId) ?? {
    projectId,
    enabled: AI_ENABLED_BY_DEFAULT,
    updatedBy: null,
    updatedAt: null,
  };

/** Only the project's Delivery Lead or an Admin turns AI on or off. */
export const canToggleAi = (user: Profile, project: Project) => canManageProject(user, project);

/**
 * Who may run each feature (on a project they can see, with AI on). Thread summaries are open to
 * every viewer, clients included: a client's summary is built from shared comments only.
 */
export function canUseAiFeature(user: Profile, feature: AiFeature): boolean {
  switch (feature) {
    case 'status_report':
    case 'risk_suggestions':
      return isInternalRole(user.role);
    case 'meeting_notes':
      return canEditItems(user);
    case 'thread_summary':
      return true;
  }
}

/** "Summarize thread" is offered once a thread has more than this many comments. */
export const SUMMARY_MIN_COMMENTS = 6;

// ---------------------------------------------------------------------------
// Risk signals (KH-43): a deterministic detector, no AI needed.
// ---------------------------------------------------------------------------

export type SignalKind = 'stalled' | 'overdue' | 'sprint_miss' | 'deliverable_late';

export interface RiskSignal {
  /** Stable id, e.g. `stalled:<itemId>`. Accepting or dismissing a suggestion records these. */
  key: string;
  kind: SignalKind;
  title: string;
  detail: string;
  /** Work items the signal is about (their keys). */
  itemKeys: string[];
  /** Highest visibility of what the signal refers to: internal when any part is internal. */
  visibility: Visibility;
}

export type SignalItem = Pick<
  WorkItem,
  | 'id'
  | 'key'
  | 'title'
  | 'type'
  | 'status'
  | 'estimate'
  | 'sprintId'
  | 'dueDate'
  | 'createdAt'
  | 'visibility'
> & { deletedAt?: string | null };

export interface SignalInput {
  items: SignalItem[];
  history: Pick<StatusChange, 'itemId' | 'to' | 'at'>[];
  sprints: Pick<Sprint, 'id' | 'name' | 'startDate' | 'endDate' | 'status'>[];
  deliverables: Pick<Deliverable, 'id' | 'name' | 'dueDate' | 'status' | 'visibility' | 'itemIds'>[];
  now: Date;
  /** Evaluate as of `now` + this many days, to warn early. Default 0. */
  lookaheadDays?: number;
  /** An in-progress or in-review item with no status change for this many days is stalled. */
  stalledDays?: number;
}

export const STALLED_DAYS = 7;
export const MAX_LOOKAHEAD_DAYS = 30;
const ACTIVE: ItemStatus[] = ['in_progress', 'in_review'];
const DAY_MS = 86_400_000;
const STATUS_WORD: Partial<Record<ItemStatus, string>> = {
  in_progress: 'In Progress',
  in_review: 'In Review',
};

const daysBetween = (fromIso: string, to: Date) =>
  Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Signals that a project is slipping, as of `now` (+ look-ahead):
 * - stalled: In Progress / In Review with no status change for `stalledDays` days
 * - overdue: a due date before today on an item that is not done
 * - sprint_miss: the active sprint's burndown trends below its scope at the end date
 * - deliverable_late: a deliverable past its due date and not accepted
 * Sorted by kind then key so the same data always gives the same list.
 */
export function detectRiskSignals(input: SignalInput): RiskSignal[] {
  const look = Math.max(0, Math.min(MAX_LOOKAHEAD_DAYS, Math.floor(input.lookaheadDays ?? 0)));
  const stalledDays = Math.max(1, Math.floor(input.stalledDays ?? STALLED_DAYS));
  const asOf = new Date(input.now.getTime() + look * DAY_MS);
  const today = isoDay(asOf);
  const items = input.items.filter((i) => !i.deletedAt);
  const lastChange = new Map<string, string>();
  for (const h of input.history) {
    const item = items.find((i) => i.id === h.itemId);
    if (!item || h.to !== item.status) continue;
    const prev = lastChange.get(h.itemId);
    if (!prev || h.at > prev) lastChange.set(h.itemId, h.at);
  }
  const out: RiskSignal[] = [];

  for (const i of items) {
    if (!ACTIVE.includes(i.status)) continue;
    const since = lastChange.get(i.id) ?? i.createdAt;
    const days = daysBetween(since, asOf);
    if (days >= stalledDays)
      out.push({
        key: `stalled:${i.id}`,
        kind: 'stalled',
        title: `${i.key} stalled in ${STATUS_WORD[i.status]}`,
        detail: `${i.key} "${i.title}" has had no status change for ${plural(days, 'day')}.`,
        itemKeys: [i.key],
        visibility: i.visibility,
      });
  }

  for (const i of items) {
    if (!i.dueDate || i.dueDate >= today || isDone(i.status) || i.type === 'epic') continue;
    const days = daysBetween(i.dueDate + 'T00:00:00.000Z', new Date(today + 'T00:00:00.000Z'));
    out.push({
      key: `overdue:${i.id}`,
      kind: 'overdue',
      title: `${i.key} past its due date`,
      detail: `${i.key} "${i.title}" was due ${i.dueDate} (${plural(days, 'day')} ago) and is not done.`,
      itemKeys: [i.key],
      visibility: i.visibility,
    });
  }

  for (const s of input.sprints) {
    if (s.status !== 'active') continue;
    const scope = items.filter((i) => i.sprintId === s.id);
    const total = scope.reduce((t, i) => t + (i.estimate ?? 0), 0);
    if (!total) continue;
    const done = scope.filter((i) => isDone(i.status)).reduce((t, i) => t + (i.estimate ?? 0), 0);
    const start = new Date(s.startDate + 'T00:00:00.000Z').getTime();
    const end = new Date(addDays(s.endDate, 1) + 'T00:00:00.000Z').getTime();
    const elapsed = Math.min(1, Math.max(0, (asOf.getTime() - start) / Math.max(1, end - start)));
    if (elapsed < 0.3 || done >= total) continue;
    const projected = Math.round(done / elapsed);
    if (projected >= total * 0.9) continue;
    const open = scope.filter((i) => !isDone(i.status));
    out.push({
      key: `sprint_miss:${s.id}`,
      kind: 'sprint_miss',
      title: `${s.name} trending to miss`,
      detail: `${done} of ${total} points done with ${Math.round(elapsed * 100)}% of the sprint gone; at this pace about ${projected} points finish by ${s.endDate}.`,
      itemKeys: open.slice(0, 10).map((i) => i.key),
      visibility: open.some((i) => i.visibility === 'internal') ? 'internal' : 'shared',
    });
  }

  for (const d of input.deliverables) {
    if (!d.dueDate || d.dueDate >= today || d.status === 'accepted') continue;
    const linked = items.filter((i) => d.itemIds.includes(i.id));
    out.push({
      key: `deliverable_late:${d.id}`,
      kind: 'deliverable_late',
      title: `Deliverable "${d.name}" past due`,
      detail: `Deliverable "${d.name}" was due ${d.dueDate} and is ${d.status === 'submitted' ? 'still awaiting acceptance' : 'not accepted'}.`,
      itemKeys: linked.slice(0, 10).map((i) => i.key),
      visibility:
        d.visibility === 'internal' || linked.some((i) => i.visibility === 'internal')
          ? 'internal'
          : 'shared',
    });
  }

  const order: SignalKind[] = ['stalled', 'overdue', 'sprint_miss', 'deliverable_late'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.key.localeCompare(b.key));
}

/** Signals not already accepted or dismissed (by key). */
export const undecidedSignals = (signals: RiskSignal[], decided: Iterable<string>) => {
  const done = new Set(decided);
  return signals.filter((s) => !done.has(s.key));
};

export const MAX_SIGNALS_PER_RUN = 20;

/** A YYYY-MM-DD date `n` days after `now` (UTC). */
export const dayFrom = (now: Date, n: number) => addDays(isoDay(now), n);
