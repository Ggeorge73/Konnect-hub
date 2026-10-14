import type { Comment, Session } from '../domain/types';
import { canManageProject } from '../domain/permissions';
import { getRepo } from './index';
import { listRaid } from './raid';
import { listDeliverables } from './deliverables';
import { getGates } from './gates';
import { recordAudit } from './audit';
import { ForbiddenError } from './errors';

export const PROJECT_EXPORT_VERSION = 1;

/**
 * Full project JSON export (KH-39, CLAUDE.md 3.11): project, phases (with gate criteria),
 * sprints, members, work items, comments, RAID, deliverables and gate reviews. Admin or the
 * project's Lead only. Read through the active stores as the caller, then audited as export.json.
 */
export async function buildProjectExport(s: Session, key: string, ip?: string, now: Date = new Date()) {
  const repo = getRepo();
  const bundle = await repo.getProjectBundle(s, key.toUpperCase());
  if (!canManageProject(s.user, bundle.project))
    throw new ForbiddenError('Only the project Lead or an Admin can export the whole project.');
  const k = bundle.project.key;
  const [items, raid, deliverables, gates] = await Promise.all([
    repo.listItems(s, { projectId: bundle.project.id }),
    listRaid(s, { projectId: bundle.project.id }, now),
    listDeliverables(s, k),
    getGates(s, k),
  ]);
  const comments: Comment[] = [];
  for (const i of items) comments.push(...(await repo.getItem(s, i.key)).comments);

  const out = {
    format: 'konnect-hub.project',
    version: PROJECT_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    exportedBy: { id: s.user.id, name: s.user.name },
    project: bundle.project,
    client: bundle.client,
    members: bundle.members,
    phases: gates.phases.map((p) => ({ ...p, criteria: gates.criteria.filter((c) => c.phaseId === p.id) })),
    sprints: bundle.sprints,
    items,
    comments,
    raid,
    deliverables,
    gateReviews: gates.reviews,
  };
  const counts = {
    items: items.length,
    comments: comments.length,
    raid: raid.length,
    deliverables: deliverables.length,
    gateReviews: gates.reviews.length,
  };
  await recordAudit(
    s,
    {
      action: 'export.json',
      entity: 'project',
      entityId: bundle.project.id,
      projectId: bundle.project.id,
      after: { entity: 'project', key: k, rows: items.length, counts },
    },
    ip,
  );
  return out;
}
