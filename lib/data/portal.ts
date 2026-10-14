import type { Session } from '../domain/types';
import { isClientRole } from '../domain/permissions';
import { buildInbox, canActOnApprovals, orgLogoUrl, type InboxEntry } from '../domain/portal';
import { workspaceDisplayName } from '../domain/onboarding';
import { getRepo, isPostgresEnabled } from './index';
import { db } from './memory';
import { listPendingReviews } from './gates';
import { listAwaitingAcceptance } from './deliverables';
import { getWorkspace } from './onboarding';

/**
 * Client portal read models (PRT-01). Everything is composed from the active stores (demo or
 * Postgres + RLS), so tenant isolation is whatever those already enforce; buildInbox() drops any
 * row that is not from the user's own org as a second line of defence.
 */

/** "Needs your approval": gate reviews, deliverables and Client Review items, sorted by due date. */
export async function getApprovalInbox(s: Session): Promise<InboxEntry[]> {
  if (!isClientRole(s.user.role) || !canActOnApprovals(s.user.role)) return [];
  const repo = getRepo();
  const [projects, gates, deliverables, items] = await Promise.all([
    repo.listProjects(s),
    s.user.role === 'client_sponsor' ? listPendingReviews(s) : Promise.resolve([]),
    listAwaitingAcceptance(s),
    repo.listItems(s, { status: ['client_review'] }),
  ]);
  // Phase end dates give gate reviews a due date.
  const gateKeys = [...new Set(gates.map((g) => g.projectKey))];
  const bundles = await Promise.all(gateKeys.map((k) => repo.getProjectBundle(s, k)));
  const phaseEnd = new Map(bundles.flatMap((b) => b.phases.map((p) => [p.id, p.endDate ?? null] as const)));
  const nameOf = new Map(projects.map((p) => [p.key, p.name]));
  return buildInbox(s.user, {
    projects,
    gates: gates.map((g) => ({
      reviewId: g.review.id,
      gate: g.review.gate,
      phaseName: g.phaseName,
      phaseEndDate: phaseEnd.get(g.review.phaseId) ?? null,
      summary: g.review.pack.summary,
      projectKey: g.projectKey,
      projectName: g.projectName,
    })),
    deliverables: deliverables.map((d) => ({
      id: d.id,
      name: d.name,
      dueDate: d.dueDate,
      projectKey: d.projectKey,
      projectName: nameOf.get(d.projectKey) ?? d.projectKey,
      criteria: d.criteria,
    })),
    items,
  });
}

export interface PortalBranding {
  workspaceName: string;
  workspaceLogoUrl: string | null;
  orgName: string;
  orgLogoUrl: string | null;
}

/** Header branding: the workspace (Konnector) mark plus the signed-in client's own logo. */
export async function getPortalBranding(s: Session): Promise<PortalBranding> {
  const w = await getWorkspace(s);
  const seeded = isPostgresEnabled() ? {} : db().workspace.clientLogos;
  return {
    workspaceName: workspaceDisplayName(w),
    workspaceLogoUrl: w.logoUrl,
    orgName: s.org.name,
    orgLogoUrl: orgLogoUrl(s.org, seeded),
  };
}
