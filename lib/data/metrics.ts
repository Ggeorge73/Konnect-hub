import type { Project, Session } from '../domain/types';
import { canSeeProject, isInternalRole } from '../domain/permissions';
import { isoDay, projectMetrics, type ProjectMetrics } from '../domain/metrics';
import { db } from './memory';
import { ForbiddenError, NotFoundError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresMetricsStore } from './metrics-postgres';

/**
 * Agile metrics for one project (AGL-01). Internal users only: the charts count internal items.
 * Mirrors the `status_history` RLS in supabase/migrations/0007_pulse.sql.
 *
 * `MetricsStore` has two implementations, picked like getRepo(): the demo store below and the
 * Postgres + RLS store in metrics-postgres.ts (status history written by the 0007 trigger).
 * Shared behaviour: lib/data/contract-pulse.ts.
 */
export interface MetricsStore {
  getProjectMetrics(s: Session, key: string, now?: Date): Promise<ProjectMetrics>;
}

async function memGetProjectMetrics(
  s: Session,
  key: string,
  now: Date = new Date(),
): Promise<ProjectMetrics> {
  const d = db();
  const p: Project | undefined = d.projects.find(
    (x) => (x.key === key.toUpperCase() || x.id === key) && !x.deletedAt,
  );
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  if (!isInternalRole(s.user.role)) throw new ForbiddenError('Agile metrics are internal.');
  const { sprints, items } = d.metricsArchive;
  return projectMetrics({
    sprints: [...sprints, ...d.sprints].filter((x) => x.projectId === p.id),
    items: [...items, ...d.items].filter((i) => i.projectId === p.id && !i.deletedAt),
    history: d.statusHistory.filter((h) => h.projectId === p.id),
    commitments: d.sprintCommitments,
    today: isoDay(now),
  });
}

export const memoryMetricsStore: MetricsStore = { getProjectMetrics: memGetProjectMetrics };

/** The active metrics store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const metricsStore = (): MetricsStore =>
  isPostgresEnabled() ? postgresMetricsStore() : memoryMetricsStore;

export const getProjectMetrics: MetricsStore['getProjectMetrics'] = (...a) =>
  metricsStore().getProjectMetrics(...a);
