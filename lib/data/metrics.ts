import type { Project, Session } from '../domain/types';
import { canSeeProject, isInternalRole } from '../domain/permissions';
import { isoDay, projectMetrics, type ProjectMetrics } from '../domain/metrics';
import { db } from './memory';
import { ForbiddenError, NotFoundError } from './errors';

/**
 * Agile metrics for one project (AGL-01). Internal users only: the charts count internal items.
 * Mirrors the `status_history` RLS in supabase/migrations/0007_pulse.sql.
 */
export function getProjectMetrics(s: Session, key: string, now: Date = new Date()): ProjectMetrics {
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
