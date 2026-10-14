import type { ItemStatus, Session } from '../domain/types';
import { DEFAULT_STATUSES } from '../domain/workflow';
import { resolveLimits, type BoardLimits, type BoardPage } from '../domain/board-page';
import {
  ITEM_COLS,
  asUser,
  filterSql,
  findProject,
  getSql,
  textArray,
  withCriteria,
  type Sql,
} from './postgres';
import type { BoardFilters, BoardPageFn } from './board';

/**
 * Postgres board page (KH-46). Runs as the signed-in user, so RLS decides visibility. Each
 * column is one `order by position limit n` scan of work_items_board_idx
 * (project_id, status, position) where deleted_at is null, via a LATERAL join over the statuses,
 * so a 20,000-item project reads ~100 index entries per column instead of every row.
 */
export const createPostgresBoardPage =
  (sql: Sql): BoardPageFn =>
  (s: Session, projectKey: string, filters: BoardFilters, limits: BoardLimits): Promise<BoardPage> => {
    const lim = resolveLimits(limits);
    const statuses = DEFAULT_STATUSES.map((x) => x.id);
    return asUser(sql, s.user.id, async (tx) => {
      const p = await findProject(tx, projectKey);
      const f = { ...filters, q: undefined, projectId: p.id };
      const like = filters.q ? `%${filters.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const cardQ = like
        ? tx`and (lower(w.title) like ${like} or lower(w.key) like ${like}
                or exists (select 1 from unnest(w.labels) l where lower(l) like ${like}))`
        : tx``;
      const [rows, counts, parents] = await Promise.all([
        tx`
        select x.* from unnest(${textArray(statuses)}::public.item_status[],
                               ${`{${statuses.map((st) => lim[st]).join(',')}}`}::int[]) as col(status, lim)
        cross join lateral (
          select ${ITEM_COLS(tx)} from public.work_items w
          where w.deleted_at is null and w.status = col.status ${filterSql(tx, f)} ${cardQ}
          order by w.position, w.number
          limit col.lim
        ) x
        order by x.position, x.number`,
        tx`
        select w.status::text as status, count(*)::int as n from public.work_items w
        where w.deleted_at is null ${filterSql(tx, f)} ${cardQ}
        group by w.status`,
        tx`
        select w.id, w.key, w.type, w.title, w.parent_id from public.work_items w
        where w.deleted_at is null and w.project_id = ${p.id} and w.type in ('epic', 'feature')
        order by w.position`,
      ]);
      const totals = Object.fromEntries(statuses.map((st) => [st, 0])) as Record<ItemStatus, number>;
      for (const c of counts) totals[c.status as ItemStatus] = c.n;
      return {
        items: await withCriteria(tx, rows),
        totals,
        limits: lim,
        ancestors: parents.map((r) => ({
          id: r.id,
          key: r.key,
          type: r.type,
          title: r.title,
          parentId: r.parent_id ?? null,
        })),
      };
    });
  };

export const postgresBoardPage: BoardPageFn = (...a) => createPostgresBoardPage(getSql())(...a);
