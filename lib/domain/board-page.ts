/**
 * KH-46: server-side paging for the Kanban board. A board never downloads a whole project: it
 * asks for the first N cards of every status column (by board position) plus per-column totals,
 * and asks for more of one column when that column is scrolled to its end. Pure; used by both
 * the demo store and (as the same rules in SQL) the Postgres store.
 */
import type { ItemStatus, ItemType, WorkItem } from './types';
import { DEFAULT_STATUSES } from './workflow';

/** Cards per column on first load: 7 columns × 100 covers the 500-visible-card target. */
export const BOARD_PAGE_SIZE = 100;
/** Upper bound for one column's limit (a column grows by BOARD_PAGE_SIZE per "load more"). */
export const BOARD_MAX_LIMIT = 5_000;

export type BoardLimits = Partial<Record<ItemStatus, number>>;

/** Just enough of an epic or feature to label swimlanes and walk a card up to its epic. */
export type BoardAncestor = Pick<WorkItem, 'id' | 'key' | 'type' | 'title' | 'parentId'>;

export interface BoardPage {
  /** Loaded cards (every status), ordered by position. */
  items: WorkItem[];
  /** Matching cards per status, loaded or not (drives counts and WIP limits). */
  totals: Record<ItemStatus, number>;
  /** Limit applied per status. */
  limits: Record<ItemStatus, number>;
  /** All epics and features of the project, for swimlanes by epic. */
  ancestors: BoardAncestor[];
}

const STATUS_IDS = DEFAULT_STATUSES.map((s) => s.id);
const ANCESTOR_TYPES: ItemType[] = ['epic', 'feature'];

export const clampLimit = (n: unknown, fallback = BOARD_PAGE_SIZE) => {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(v, BOARD_MAX_LIMIT) : fallback;
};

/** Parses `backlog:200,ready:100` (unknown statuses and bad numbers are dropped). */
export function parseLimits(raw: string | null | undefined): BoardLimits {
  const out: BoardLimits = {};
  for (const part of (raw ?? '').split(',')) {
    const [status, n] = part.split(':');
    if (STATUS_IDS.includes(status as ItemStatus) && Number(n) > 0) out[status as ItemStatus] = clampLimit(n);
  }
  return out;
}

export const formatLimits = (l: BoardLimits) =>
  STATUS_IDS.filter((s) => l[s])
    .map((s) => `${s}:${l[s]}`)
    .join(',');

export function resolveLimits(l: BoardLimits, pageSize = BOARD_PAGE_SIZE): Record<ItemStatus, number> {
  return Object.fromEntries(STATUS_IDS.map((s) => [s, clampLimit(l[s], pageSize)])) as Record<
    ItemStatus,
    number
  >;
}

/**
 * Pages already-filtered, permission-checked items. `items` may be in any order; the page is
 * ordered by position (then number) like the board index in Postgres.
 */
export function pageBoard(items: WorkItem[], limits: BoardLimits, pageSize = BOARD_PAGE_SIZE): BoardPage {
  const lim = resolveLimits(limits, pageSize);
  const totals = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<ItemStatus, number>;
  const sorted = [...items].sort((a, b) => a.position - b.position || a.number - b.number);
  const out: WorkItem[] = [];
  for (const i of sorted) {
    const n = (totals[i.status] = (totals[i.status] ?? 0) + 1);
    if (n <= (lim[i.status] ?? pageSize)) out.push(i);
  }
  return { items: out, totals, limits: lim, ancestors: [] };
}

export const ancestorsOf = (items: WorkItem[]): BoardAncestor[] =>
  items
    .filter((i) => ANCESTOR_TYPES.includes(i.type))
    .map(({ id, key, type, title, parentId }) => ({ id, key, type, title, parentId: parentId ?? null }));

/** True when a column has more matching cards than it has loaded. */
export const hasMore = (page: Pick<BoardPage, 'totals' | 'limits'>, status: ItemStatus) =>
  (page.totals[status] ?? 0) > (page.limits[status] ?? 0);

/** The board's "Filter cards" box: title or key contains the text, or a label does (case-insensitive). */
export function matchesCardQuery(
  i: Pick<WorkItem, 'title' | 'key' | 'labels'>,
  q: string | undefined,
): boolean {
  const t = q?.trim().toLowerCase();
  if (!t) return true;
  return (
    i.title.toLowerCase().includes(t) ||
    i.key.toLowerCase().includes(t) ||
    i.labels.some((l) => l.toLowerCase().includes(t))
  );
}
