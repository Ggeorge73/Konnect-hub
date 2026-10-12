import type { AcceptanceCriterion, ItemStatus, Profile, Project, Visibility, WorkItem } from './types';
import { isClientRole } from './permissions';

/** Deliverable acceptance rules (DLV-01). Pure functions only. */

export type DeliverableStatus = 'draft' | 'submitted' | 'accepted' | 'rejected';

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting acceptance',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

export interface DeliverableCriterion extends AcceptanceCriterion {
  /** Client IP recorded with the decision (from X-Forwarded-For). */
  ip?: string;
}

export interface Deliverable {
  id: string;
  projectId: string;
  phaseId: string | null;
  name: string;
  description: string;
  ownerId: string;
  dueDate: string | null;
  visibility: Visibility;
  status: DeliverableStatus;
  itemIds: string[];
  criteria: DeliverableCriterion[];
  createdBy: string;
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
}

/** Status the item moves to when a deliverable it belongs to is rejected. */
export const REOPEN_STATUS: ItemStatus = 'in_progress';

/**
 * Roll-up: any rejected criterion rejects the deliverable; all accepted accepts it;
 * otherwise it stays awaiting acceptance.
 */
export function rollUp(criteria: Pick<AcceptanceCriterion, 'status'>[]): DeliverableStatus {
  if (criteria.some((c) => c.status === 'rejected')) return 'rejected';
  if (criteria.length > 0 && criteria.every((c) => c.status === 'accepted')) return 'accepted';
  return 'submitted';
}

/** Linked items to move back to In Progress after a rejection. */
export const itemsToReopen = (items: WorkItem[]) =>
  items.filter((i) => !i.deletedAt && i.status !== REOPEN_STATUS);

/** Sponsors and members of the project's own client org accept or reject criteria. Viewers cannot. */
export const canDecideDeliverable = (user: Profile, project: Project) =>
  (user.role === 'client_sponsor' || user.role === 'client_member') &&
  user.orgId === project.clientOrgId &&
  !project.deletedAt;

/** Internal staff (not clients) create, edit and submit deliverables. */
export const canEditDeliverables = (user: Profile) => !isClientRole(user.role);

/** Clients see shared deliverables once they have been submitted. */
export const canSeeDeliverable = (user: Profile, d: Deliverable) =>
  !isClientRole(user.role) || (d.visibility === 'shared' && d.status !== 'draft');

export type Validation = { ok: true } | { ok: false; reason: string };

export function canSubmit(d: Deliverable): Validation {
  if (d.status === 'submitted') return { ok: false, reason: 'Already awaiting acceptance.' };
  if (d.status === 'accepted') return { ok: false, reason: 'Already accepted.' };
  if (d.visibility !== 'shared')
    return { ok: false, reason: 'Share the deliverable with the client before submitting it.' };
  if (d.criteria.length === 0) return { ok: false, reason: 'Add at least one acceptance criterion.' };
  return { ok: true };
}

export function canDecideCriterion(d: Deliverable, criterionId: string): Validation {
  if (d.status !== 'submitted') return { ok: false, reason: 'This deliverable is not awaiting acceptance.' };
  if (!d.criteria.some((c) => c.id === criterionId)) return { ok: false, reason: 'Criterion not found.' };
  return { ok: true };
}

/** Criteria reset to pending when a deliverable is (re)submitted. */
export const resetCriteria = (criteria: DeliverableCriterion[]): DeliverableCriterion[] =>
  criteria.map((c) => ({ id: c.id, text: c.text, status: 'pending' }));

/** Turn free-text lines into criteria, dropping blanks. */
export const criteriaFromLines = (lines: string[], idFor: (i: number) => string): DeliverableCriterion[] =>
  lines
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, i) => ({ id: idFor(i), text, status: 'pending' as const }));
