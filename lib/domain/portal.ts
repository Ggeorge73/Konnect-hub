import { z } from 'zod';
import type { ItemStatus, Organization, Phase, Priority, Profile, Project, Role, Sprint } from './types';
import { isPassed } from './gates';

/** Client portal rules (PRT-01). Pure functions only. */

// ---------------------------------------------------------------------------
// "Needs your approval" inbox
// ---------------------------------------------------------------------------

export type InboxKind = 'gate' | 'deliverable' | 'item';

export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  gate: 'Gate review',
  deliverable: 'Deliverable',
  item: 'Work item',
};

/** One thing waiting on the signed-in client user. */
export interface InboxEntry {
  kind: InboxKind;
  /** Gate review id, deliverable id or work item id. */
  id: string;
  projectKey: string;
  projectName: string;
  title: string;
  /** What the action is about, e.g. "2 acceptance criteria" or the gate pack summary. */
  detail: string;
  /** YYYY-MM-DD, or null when there is no due date. */
  dueDate: string | null;
  /** Deep link in the portal. */
  href: string;
  /** Item key for work items. */
  itemKey?: string;
  /** Pending criteria ids for deliverables (the inbox accepts them all at once). */
  criterionIds?: string[];
  /** Label passed to the decision dialog, e.g. "Gate 3 · Execute for Clinic EHR". */
  decisionLabel: string;
}

export interface InboxSources {
  gates: {
    reviewId: string;
    gate: number;
    phaseName: string;
    phaseEndDate?: string | null;
    summary: string;
    projectKey: string;
    projectName: string;
  }[];
  deliverables: {
    id: string;
    name: string;
    dueDate: string | null;
    projectKey: string;
    projectName: string;
    criteria: { id: string; status: 'pending' | 'accepted' | 'rejected' }[];
  }[];
  items: {
    id: string;
    key: string;
    title: string;
    status: ItemStatus;
    dueDate?: string | null;
    projectId: string;
  }[];
  projects: Pick<Project, 'id' | 'key' | 'name' | 'clientOrgId'>[];
}

/** Clients who can act on approvals. Viewers are read-only, so nothing waits on them. */
export const canActOnApprovals = (role: Role) => role === 'client_sponsor' || role === 'client_member';

/** Only client sponsors and members raise Client Requests from the portal. */
export const canSubmitRequest = (role: Role) => canActOnApprovals(role);

const KIND_ORDER: Record<InboxKind, number> = { gate: 0, deliverable: 1, item: 2 };

/** Sorted by due date (soonest first, undated last), then gates before deliverables before items. */
export function compareInbox(a: InboxEntry, b: InboxEntry): number {
  const da = a.dueDate ?? '9999-12-31';
  const dbb = b.dueDate ?? '9999-12-31';
  if (da !== dbb) return da < dbb ? -1 : 1;
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  return a.title.localeCompare(b.title);
}

/**
 * Merges gate reviews awaiting the sponsor, deliverables awaiting acceptance and items in Client
 * Review for the user's own org into one list. Items from another org's project are dropped even
 * if a caller passed them (defence in depth: the data layer already filters by RLS rules).
 */
export function buildInbox(user: Pick<Profile, 'role' | 'orgId'>, src: InboxSources): InboxEntry[] {
  if (!canActOnApprovals(user.role)) return [];
  const own = new Map(src.projects.filter((p) => p.clientOrgId === user.orgId).map((p) => [p.id, p]));
  const ownKeys = new Set([...own.values()].map((p) => p.key));
  const out: InboxEntry[] = [];
  if (user.role === 'client_sponsor')
    for (const g of src.gates) {
      if (!ownKeys.has(g.projectKey)) continue;
      const label = `Gate ${g.gate} · ${g.phaseName}`;
      out.push({
        kind: 'gate',
        id: g.reviewId,
        projectKey: g.projectKey,
        projectName: g.projectName,
        title: label,
        detail: g.summary,
        dueDate: g.phaseEndDate ?? null,
        href: `/portal/${g.projectKey}#approvals`,
        decisionLabel: `${label} for ${g.projectName}`,
      });
    }
  for (const d of src.deliverables) {
    if (!ownKeys.has(d.projectKey)) continue;
    const pending = d.criteria.filter((c) => c.status === 'pending');
    out.push({
      kind: 'deliverable',
      id: d.id,
      projectKey: d.projectKey,
      projectName: d.projectName,
      title: d.name,
      detail: `${pending.length} of ${d.criteria.length} acceptance criteria to review`,
      dueDate: d.dueDate,
      href: `/portal/${d.projectKey}#deliverables`,
      criterionIds: pending.map((c) => c.id),
      decisionLabel: `“${d.name}”`,
    });
  }
  for (const i of src.items) {
    const p = own.get(i.projectId);
    if (!p || i.status !== 'client_review') continue;
    out.push({
      kind: 'item',
      id: i.id,
      itemKey: i.key,
      projectKey: p.key,
      projectName: p.name,
      title: i.title,
      detail: `${i.key} is ready for your review`,
      dueDate: i.dueDate ?? null,
      href: `/portal/${p.key}?item=${i.key}`,
      decisionLabel: `${i.key} ${i.title}`,
    });
  }
  return out.sort(compareInbox);
}

// ---------------------------------------------------------------------------
// Milestones timeline
// ---------------------------------------------------------------------------

export type MilestoneKind = 'sprint' | 'gate' | 'deliverable';

export const MILESTONE_KIND_LABEL: Record<MilestoneKind, string> = {
  sprint: 'Sprint end',
  gate: 'Gate',
  deliverable: 'Deliverable due',
};

export interface Milestone {
  kind: MilestoneKind;
  id: string;
  title: string;
  date: string;
  done: boolean;
}

/**
 * Read-only milestones for the portal: sprint ends, gate (phase end) dates and shared deliverable
 * due dates. Upcoming milestones first by date; completed ones are kept only when `includeDone`.
 */
export function buildMilestones(
  input: {
    sprints: Pick<Sprint, 'id' | 'name' | 'endDate' | 'status'>[];
    phases: Pick<Phase, 'id' | 'gate' | 'name' | 'endDate' | 'status'>[];
    deliverables: { id: string; name: string; dueDate: string | null; status: string }[];
  },
  today: string,
  includeDone = false,
): Milestone[] {
  const all: Milestone[] = [
    ...input.sprints.map((s) => ({
      kind: 'sprint' as const,
      id: s.id,
      title: `${s.name} ends`,
      date: s.endDate,
      done: s.status === 'completed',
    })),
    ...input.phases
      .filter((p) => p.endDate)
      .map((p) => ({
        kind: 'gate' as const,
        id: p.id,
        title: `Gate ${p.gate} · ${p.name}`,
        date: p.endDate!,
        done: isPassed(p.status),
      })),
    ...input.deliverables
      .filter((d) => d.dueDate)
      .map((d) => ({
        kind: 'deliverable' as const,
        id: d.id,
        title: d.name,
        date: d.dueDate!,
        done: d.status === 'accepted',
      })),
  ];
  return all
    .filter((m) => m.date)
    .filter((m) => includeDone || (!m.done && m.date >= today))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// "Submit a request"
// ---------------------------------------------------------------------------

export const REQUEST_PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'critical', label: 'Critical' },
];

export const clientRequestSchema = z.object({
  projectId: z.string().min(1, 'Choose a project'),
  title: z.string().trim().min(3, 'Give the request a short title').max(255, 'Keep the title under 255'),
  description: z.string().trim().max(5000, 'Keep the description under 5,000 characters').default(''),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
});
export type ClientRequestInput = z.infer<typeof clientRequestSchema>;

/** What the portal sends to POST /api/items: always a shared Client Request in the backlog. */
export const toCreateItem = (v: ClientRequestInput) => ({
  projectId: v.projectId,
  type: 'client_request' as const,
  title: v.title.trim(),
  description: v.description.trim(),
  priority: v.priority,
  status: 'backlog' as const,
  visibility: 'shared' as const,
});

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

/** The client's logo: the org's own logoUrl (Admin-editable) wins over the seeded placeholder. */
export const orgLogoUrl = (org: Pick<Organization, 'id' | 'logoUrl'>, seeded: Record<string, string> = {}) =>
  org.logoUrl || seeded[org.id] || null;
