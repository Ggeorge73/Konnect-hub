import type { Session } from '../domain/types';
import {
  ancestorsOf,
  matchesCardQuery,
  pageBoard,
  type BoardLimits,
  type BoardPage,
} from '../domain/board-page';
import type { ItemFilters } from './repo';
import { memoryRepo } from './memory';
import { isPostgresEnabled } from './index';
import { postgresBoardPage } from './board-postgres';

/**
 * KH-46: one page of the Kanban board (first N cards per status column + totals). Picked like
 * getRepo(): the demo store pages the permission-filtered list from memoryRepo.listItems (same
 * visibility rules); the Postgres store runs one index-backed LIMIT query per column under RLS.
 * `q` here is the board's card filter (title/key/label contains), not full-text search.
 */
export type BoardFilters = Omit<ItemFilters, 'projectId' | 'status'>;

export type BoardPageFn = (
  s: Session,
  projectKey: string,
  filters: BoardFilters,
  limits: BoardLimits,
) => Promise<BoardPage>;

export const getBoardPage: BoardPageFn = (...a) =>
  isPostgresEnabled() ? postgresBoardPage(...a) : memoryBoardPage(...a);

/** The demo-store implementation. Shared behaviour: lib/data/contract-board.ts. */
export const memoryBoardPage: BoardPageFn = async (s, projectKey, filters, limits) => {
  const parents = await memoryRepo.listItems(s, { projectId: projectKey, type: ['epic', 'feature'] });
  const matching = (
    await memoryRepo.listItems(s, { ...filters, q: undefined, projectId: projectKey })
  ).filter((i) => matchesCardQuery(i, filters.q));
  return { ...pageBoard(matching, limits), ancestors: ancestorsOf(parents) };
};
