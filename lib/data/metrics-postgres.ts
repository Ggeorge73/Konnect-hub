import type { Session } from '../domain/types';
import { isInternalRole } from '../domain/permissions';
import { isoDay, projectMetrics, type StatusChange } from '../domain/metrics';
import type { MetricsStore } from './metrics';
import { ForbiddenError, NotFoundError } from './errors';
import { asUser, findProject, getSql, toSprint, type Sql } from './postgres';

/**
 * Agile metrics on Postgres + RLS (KH-51). `status_history` rows are written by the 0007 trigger
 * on every status change (API, transition_work_item(), system reopen) and are internal-only under
 * RLS; the charts themselves are the shared pure functions in lib/domain/metrics.ts.
 *
 * Sprint commitments (the item set at sprint start) are not stored in Postgres yet, so velocity and
 * burndown use the sprint's current scope, which is the domain functions' documented fallback.
 */
export function createPostgresMetricsStore(sql: Sql): MetricsStore {
  return {
    async getProjectMetrics(s: Session, key: string, now: Date = new Date()) {
      return asUser(sql, s.user.id, async (tx) => {
        const p = await findProject(tx, key);
        if (p.deletedAt) throw new NotFoundError('Project not found');
        if (!isInternalRole(s.user.role)) throw new ForbiddenError('Agile metrics are internal.');
        const [sprints, items, history] = await Promise.all([
          tx`select * from public.sprints where project_id = ${p.id} order by start_date`,
          tx`select id, key, title, type, status, estimate, sprint_id, created_at, deleted_at
             from public.work_items where project_id = ${p.id} and deleted_at is null`,
          tx`select * from public.status_history where project_id = ${p.id} order by at, id`,
        ]);
        return projectMetrics({
          sprints: sprints.map(toSprint),
          items: items.map((i) => ({
            id: i.id,
            key: i.key,
            title: i.title,
            type: i.type,
            status: i.status,
            estimate: i.estimate == null ? null : Number(i.estimate),
            sprintId: i.sprint_id ?? null,
            createdAt: i.created_at,
            deletedAt: i.deleted_at ?? null,
          })),
          history: history.map((h): StatusChange => ({
            id: h.id,
            projectId: h.project_id,
            itemId: h.item_id,
            from: h.from_status ?? null,
            to: h.to_status,
            at: h.at,
            actorId: h.changed_by ?? '',
          })),
          commitments: [],
          today: isoDay(now),
        });
      });
    },
  };
}

let store: MetricsStore | undefined;
export const postgresMetricsStore = (): MetricsStore => (store ??= createPostgresMetricsStore(getSql()));
