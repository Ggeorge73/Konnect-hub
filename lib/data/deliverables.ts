import type { ItemStatus, Session, Visibility } from '../domain/types';
import { canSeeProject, canSeeVisibility, isClientRole } from '../domain/permissions';
import {
  canDecideCriterion,
  canDecideDeliverable,
  canEditDeliverables,
  canSeeDeliverable,
  canSubmit,
  criteriaFromLines,
  itemsToReopen,
  REOPEN_STATUS,
  resetCriteria,
  rollUp,
  type Deliverable,
} from '../domain/deliverables';
import { isReauthFresh } from '../domain/gates';
import { STATUS_LABEL } from '../domain/workflow';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import {
  logActivity,
  ReauthRequiredError,
  requireVisibleProject,
  writeAudit,
  type DecideContext,
} from './gates';
import { onDeliverableSubmitted } from './notify';

const now = () => new Date().toISOString();

export interface DeliverableView extends Deliverable {
  projectKey: string;
  items: { id: string; key: string; title: string; status: ItemStatus; visibility: Visibility }[];
}

function view(s: Session, d: Deliverable): DeliverableView {
  const all = db().items;
  const items = d.itemIds
    .map((id) => all.find((i) => i.id === id))
    .filter((i) => i && !i.deletedAt && canSeeVisibility(s.user, i.visibility))
    .map((i) => ({ id: i!.id, key: i!.key, title: i!.title, status: i!.status, visibility: i!.visibility }));
  const projectKey = db().projects.find((p) => p.id === d.projectId)?.key ?? '';
  return { ...d, itemIds: items.map((i) => i.id), items, projectKey };
}

function requireDeliverable(s: Session, id: string) {
  const d = db().deliverables.find((x) => x.id === id);
  if (!d || !canSeeDeliverable(s.user, d)) throw new NotFoundError('Deliverable not found');
  const project = requireVisibleProject(s, d.projectId);
  return { d, project };
}

export async function listDeliverables(s: Session, key: string): Promise<DeliverableView[]> {
  const project = requireVisibleProject(s, key);
  return db()
    .deliverables.filter((d) => d.projectId === project.id && canSeeDeliverable(s.user, d))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .map((d) => view(s, d));
}

/** Deliverables awaiting a decision from this client user ("Needs your approval"). */
export async function listAwaitingAcceptance(s: Session): Promise<DeliverableView[]> {
  const dbx = db();
  return dbx.deliverables
    .filter((d) => d.status === 'submitted' && canSeeDeliverable(s.user, d))
    .filter((d) => {
      const p = dbx.projects.find((x) => x.id === d.projectId);
      return p && canSeeProject(s.user, p, dbx.members) && canDecideDeliverable(s.user, p);
    })
    .map((d) => view(s, d));
}

export interface DeliverableInput {
  name: string;
  description?: string;
  phaseId?: string | null;
  ownerId: string;
  dueDate?: string | null;
  visibility: Visibility;
  itemIds: string[];
  criteria: string[];
}

function validate(projectId: string, input: Partial<DeliverableInput>) {
  const d = db();
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError('Name is required.');
  if (input.phaseId && !d.phases.some((p) => p.id === input.phaseId && p.projectId === projectId))
    throw new ValidationError('Unknown phase.');
  if (input.ownerId !== undefined) {
    const owner = d.profiles.find((p) => p.id === input.ownerId);
    if (!owner || isClientRole(owner.role))
      throw new ValidationError('Owner must be a Konnector team member.');
  }
  for (const id of input.itemIds ?? [])
    if (!d.items.some((i) => i.id === id && i.projectId === projectId && !i.deletedAt))
      throw new ValidationError('Linked items must belong to this project.');
}

export async function createDeliverable(s: Session, key: string, input: DeliverableInput) {
  const project = requireVisibleProject(s, key);
  if (!canEditDeliverables(s.user)) throw new ForbiddenError('Only the Konnector team creates deliverables.');
  validate(project.id, input);
  const id = newId('dl');
  const d: Deliverable = {
    id,
    projectId: project.id,
    phaseId: input.phaseId ?? null,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    ownerId: input.ownerId,
    dueDate: input.dueDate || null,
    visibility: input.visibility,
    status: 'draft',
    itemIds: [...new Set(input.itemIds)],
    criteria: criteriaFromLines(input.criteria, (i) => `${id}_c${i}`),
    createdBy: s.user.id,
    createdAt: now(),
  };
  db().deliverables.push(d);
  // Project-level activity is visible to clients, so internal deliverables are only audited.
  if (d.visibility === 'shared')
    logActivity(s, project.id, 'deliverable.created', `Deliverable "${d.name}" created`);
  writeAudit(s, 'deliverable.create', 'deliverable', d.id, undefined, d);
  return view(s, d);
}

export async function updateDeliverable(s: Session, id: string, patch: Partial<DeliverableInput>) {
  const { d } = requireDeliverable(s, id);
  if (!canEditDeliverables(s.user)) throw new ForbiddenError('Only the Konnector team edits deliverables.');
  if (d.status === 'submitted' || d.status === 'accepted')
    throw new ValidationError('Deliverables awaiting or past acceptance cannot be edited.');
  validate(d.projectId, patch);
  const before = structuredClone(d);
  if (patch.name !== undefined) d.name = patch.name.trim();
  if (patch.description !== undefined) d.description = patch.description.trim();
  if (patch.phaseId !== undefined) d.phaseId = patch.phaseId;
  if (patch.ownerId !== undefined) d.ownerId = patch.ownerId;
  if (patch.dueDate !== undefined) d.dueDate = patch.dueDate || null;
  if (patch.visibility !== undefined) d.visibility = patch.visibility;
  if (patch.itemIds !== undefined) d.itemIds = [...new Set(patch.itemIds)];
  if (patch.criteria !== undefined) {
    const texts = patch.criteria.map((t) => t.trim()).filter(Boolean);
    d.criteria = texts.map(
      (text, i) =>
        d.criteria.find((c) => c.text === text) ?? {
          id: `${d.id}_c${Date.now()}${i}`,
          text,
          status: 'pending',
        },
    );
  }
  writeAudit(s, 'deliverable.update', 'deliverable', d.id, before, structuredClone(d));
  return view(s, d);
}

export async function submitDeliverable(s: Session, id: string) {
  const { d, project } = requireDeliverable(s, id);
  if (!canEditDeliverables(s.user)) throw new ForbiddenError('Only the Konnector team submits deliverables.');
  const ok = canSubmit(d);
  if (!ok.ok) throw new ValidationError(ok.reason);
  const before = d.status;
  d.criteria = resetCriteria(d.criteria);
  d.status = 'submitted';
  d.submittedAt = now();
  d.decidedAt = undefined;
  logActivity(
    s,
    project.id,
    'deliverable.submitted',
    `Deliverable "${d.name}" submitted for client acceptance`,
  );
  writeAudit(s, 'deliverable.submit', 'deliverable', d.id, before, d.status);
  onDeliverableSubmitted(s, project, d);
  return view(s, d);
}

export async function decideCriterion(
  s: Session,
  id: string,
  criterionId: string,
  input: { status: 'accepted' | 'rejected'; note?: string },
  ctx: DecideContext,
) {
  const { d, project } = requireDeliverable(s, id);
  if (!canDecideDeliverable(s.user, project))
    throw new ForbiddenError("Only the client's Sponsor or Members can accept deliverables.");
  const ok = canDecideCriterion(d, criterionId);
  if (!ok.ok) throw new ValidationError(ok.reason);
  const at = ctx.now ?? new Date();
  if (!isReauthFresh(ctx.reauthAt, at)) throw new ReauthRequiredError();

  const c = d.criteria.find((x) => x.id === criterionId)!;
  const before = { ...c };
  Object.assign(c, {
    status: input.status,
    note: input.note?.trim() || undefined,
    decidedBy: s.user.id,
    decidedAt: at.toISOString(),
    ip: ctx.ip,
  });
  const prevStatus = d.status;
  d.status = rollUp(d.criteria);
  writeAudit(
    s,
    'deliverable.criterion_decide',
    'deliverable',
    d.id,
    { criterion: before, status: prevStatus },
    { criterion: { ...c }, status: d.status },
    ctx.ip,
  );
  logActivity(
    s,
    project.id,
    'deliverable.criterion',
    `${s.user.name} ${input.status} "${c.text}" on "${d.name}"`,
  );

  if (d.status !== prevStatus && d.status !== 'submitted') {
    d.decidedAt = at.toISOString();
    logActivity(
      s,
      project.id,
      d.status === 'accepted' ? 'deliverable.accepted' : 'deliverable.rejected',
      `Deliverable "${d.name}" ${d.status} by ${s.user.name}`,
    );
  }
  if (d.status === 'rejected' && prevStatus !== 'rejected') reopenLinkedItems(s, d);
  return view(s, d);
}

/**
 * System action: a rejected deliverable reopens its linked items. This deliberately bypasses the
 * workflow rule that stops clients moving items, because the rule is the system's, not the client's.
 */
function reopenLinkedItems(s: Session, d: Deliverable) {
  const items = db().items.filter((i) => d.itemIds.includes(i.id));
  for (const item of itemsToReopen(items)) {
    const from = item.status;
    item.status = REOPEN_STATUS;
    item.updatedAt = now();
    logActivity(
      s,
      item.projectId,
      'item.reopened',
      `${item.key} reopened (${STATUS_LABEL[from]} → ${STATUS_LABEL[REOPEN_STATUS]}): deliverable "${d.name}" was rejected`,
      item.id,
    );
    writeAudit(s, 'item.system_reopen', 'work_item', item.id, from, REOPEN_STATUS);
  }
}
