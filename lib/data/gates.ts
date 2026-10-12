import { riskScore } from '../domain/raid';
import type { GateCriterion, Phase, Project, Session, WorkItem } from '../domain/types';
import { canSeeProject } from '../domain/permissions';
import {
  applyDecision,
  buildSummary,
  canDecideGate,
  canEditCriteria,
  canManageGates,
  canRequestReview,
  checkExitCriteria,
  conditionsToItems,
  DECISION_LABEL,
  isReauthFresh,
  redactReview,
  validateDecision,
  type DecisionInput,
  type GatePack,
  type GateReview,
} from '../domain/gates';
import { db } from './memory';
import { isPostgresEnabled } from './index';
import { postgresGateStore } from './gates-postgres';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ReauthRequiredError, ValidationError } from './errors';

export { ReauthRequiredError };

/**
 * Gate criteria, review requests and sponsor decisions. `GateStore` has two implementations,
 * picked like getRepo(): the demo store below and the Postgres + RLS store in gates-postgres.ts
 * (request_gate_review / decide_gate RPCs). Shared behaviour: lib/data/contract-gates.ts.
 */
export interface GateStore {
  getGates(s: Session, key: string): Promise<GatesOverview>;
  addCriterion(s: Session, key: string, phaseId: string, text: string): Promise<GateCriterion>;
  updateCriterion(
    s: Session,
    key: string,
    criterionId: string,
    patch: { text?: string; done?: boolean },
  ): Promise<GateCriterion>;
  removeCriterion(s: Session, key: string, criterionId: string): Promise<{ ok: boolean }>;
  requestReview(s: Session, key: string, input: RequestReviewInput): Promise<GateReview>;
  /** Pending reviews the signed-in user may decide (Client Sponsor of the project's org only). */
  listPendingReviews(s: Session): Promise<PendingGateReview[]>;
  /** Client Sponsor decision; needs a fresh re-auth (`ctx.reauthAt`, from the signed cookie). */
  decideGate(s: Session, reviewId: string, input: DecisionInput, ctx: DecideContext): Promise<GateReview>;
}

const now = () => new Date().toISOString();
const nameOf = (id?: string) => db().profiles.find((p) => p.id === id)?.name ?? 'Someone';

export function requireVisibleProject(s: Session, keyOrId: string): Project {
  const d = db();
  const p = d.projects.find((x) => x.id === keyOrId || x.key === keyOrId.toUpperCase());
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

export function logActivity(s: Session, projectId: string, action: string, detail: string, itemId?: string) {
  db().activity.push({ id: newId('ac'), projectId, itemId, actorId: s.user.id, action, detail, at: now() });
}

export function writeAudit(
  s: Session,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  ip?: string,
) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action,
    entity,
    entityId,
    before,
    after,
    ip,
    at: now(),
  });
}

/**
 * System action: creates a work item on behalf of a rule (e.g. gate conditions), bypassing the
 * per-role item rules that would otherwise stop a client from creating tasks.
 */
export function systemCreateItem(
  s: Session,
  project: Project,
  input: Pick<
    WorkItem,
    'type' | 'title' | 'description' | 'visibility' | 'labels' | 'status' | 'priority'
  > & {
    phaseId: string | null;
  },
): WorkItem {
  const d = db();
  const stored = d.projects.find((p) => p.id === project.id)!;
  const n = stored.nextItemNumber++;
  const t = now();
  const item: WorkItem = {
    id: newId('wi'),
    projectId: project.id,
    number: n,
    key: `${project.key}-${n}`,
    ...input,
    assigneeId: project.leadId,
    reporterId: s.user.id,
    sprintId: null,
    parentId: null,
    estimate: null,
    dueDate: null,
    acceptanceCriteria: [],
    position: Math.max(0, ...d.items.filter((i) => i.projectId === project.id).map((i) => i.position)) + 1000,
    createdAt: t,
    updatedAt: t,
  };
  d.items.push(item);
  return item;
}

/** Open risks for the Gate Pack, highest score first. Visibility filtering happens where the pack is served. */
export function openRisksFor(projectId: string): GatePack['openRisks'] {
  return db()
    .raid.filter((r) => r.projectId === projectId && r.kind === 'risk' && r.status !== 'closed')
    .map((r) => ({
      id: r.id,
      title: r.title,
      score: riskScore(r.probability, r.impact) ?? undefined,
      visibility: r.visibility,
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

const phasesOf = (projectId: string) =>
  db()
    .phases.filter((p) => p.projectId === projectId)
    .sort((a, b) => a.gate - b.gate);
const criteriaOf = (phaseId: string) => db().criteria.filter((c) => c.phaseId === phaseId);

function requirePhase(project: Project, phaseId: string): Phase {
  const ph = phasesOf(project.id).find((p) => p.id === phaseId);
  if (!ph) throw new NotFoundError('Phase not found');
  return ph;
}

function requireManager(s: Session, project: Project) {
  if (!canManageGates(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can manage gates.');
}

export interface GatesOverview {
  phases: Phase[];
  criteria: GateCriterion[];
  reviews: GateReview[];
  canManage: boolean;
  canDecide: boolean;
}

async function memGetGates(s: Session, key: string): Promise<GatesOverview> {
  const project = requireVisibleProject(s, key);
  const phases = phasesOf(project.id);
  const ids = new Set(phases.map((p) => p.id));
  return {
    phases,
    criteria: db().criteria.filter((c) => ids.has(c.phaseId)),
    reviews: db()
      .gateReviews.filter((r) => r.projectId === project.id)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
      .map((r) => redactReview(s.user, r)),
    canManage: canManageGates(s.user, project),
    canDecide: canDecideGate(s.user, project),
  };
}

async function memAddCriterion(s: Session, key: string, phaseId: string, text: string) {
  const project = requireVisibleProject(s, key);
  requireManager(s, project);
  const phase = requirePhase(project, phaseId);
  const ok = canEditCriteria(phase);
  if (!ok.ok) throw new ValidationError(ok.reason);
  if (!text.trim()) throw new ValidationError('Criterion text is required.');
  const c: GateCriterion = { id: newId('gc'), phaseId, text: text.trim(), done: false };
  db().criteria.push(c);
  writeAudit(s, 'gate_criterion.create', 'gate_criterion', c.id, undefined, c);
  return c;
}

async function memUpdateCriterion(
  s: Session,
  key: string,
  criterionId: string,
  patch: { text?: string; done?: boolean },
) {
  const project = requireVisibleProject(s, key);
  requireManager(s, project);
  const c = db().criteria.find((x) => x.id === criterionId);
  if (!c) throw new NotFoundError('Criterion not found');
  const phase = requirePhase(project, c.phaseId);
  const ok = canEditCriteria(phase);
  if (!ok.ok) throw new ValidationError(ok.reason);
  const before = { ...c };
  if (patch.text !== undefined) {
    if (!patch.text.trim()) throw new ValidationError('Criterion text is required.');
    c.text = patch.text.trim();
  }
  if (patch.done !== undefined && patch.done !== c.done) {
    c.done = patch.done;
    c.doneBy = patch.done ? s.user.id : undefined;
    c.doneAt = patch.done ? now() : undefined;
  }
  writeAudit(s, 'gate_criterion.update', 'gate_criterion', c.id, before, { ...c });
  return c;
}

async function memRemoveCriterion(s: Session, key: string, criterionId: string) {
  const project = requireVisibleProject(s, key);
  requireManager(s, project);
  const d = db();
  const c = d.criteria.find((x) => x.id === criterionId);
  if (!c) throw new NotFoundError('Criterion not found');
  const ok = canEditCriteria(requirePhase(project, c.phaseId));
  if (!ok.ok) throw new ValidationError(ok.reason);
  d.criteria = d.criteria.filter((x) => x.id !== criterionId);
  writeAudit(s, 'gate_criterion.delete', 'gate_criterion', c.id, c);
  return { ok: true };
}

export interface RequestReviewInput {
  phaseId: string;
  overrideNote?: string;
  summary?: string;
  shareBudget?: boolean;
}

async function memRequestReview(s: Session, key: string, input: RequestReviewInput) {
  const project = requireVisibleProject(s, key);
  requireManager(s, project);
  const d = db();
  const phases = phasesOf(project.id);
  const phase = requirePhase(project, input.phaseId);
  const can = canRequestReview(phase, phases);
  if (!can.ok) throw new ValidationError(can.reason);
  if (d.gateReviews.some((r) => r.phaseId === phase.id && r.status === 'pending'))
    throw new ValidationError('A gate review is already pending for this phase.');
  const criteria = criteriaOf(phase.id);
  const check = checkExitCriteria(criteria, input.overrideNote);
  if (!check.ok) throw new ValidationError(check.reason);

  const deliverables = d.deliverables
    .filter((x) => x.projectId === project.id && x.phaseId === phase.id)
    .map((x) => ({ id: x.id, name: x.name, status: x.status, visibility: x.visibility }));
  const openRisks = openRisksFor(project.id);
  const work = d.items.filter(
    (i) => i.projectId === project.id && !i.deletedAt && i.type !== 'epic' && i.type !== 'feature',
  );
  const done = work.filter((i) => i.status === 'done' || i.status === 'accepted').length;
  const completed = criteria.filter((c) => c.done);
  const pack: GatePack = {
    summary:
      input.summary?.trim() ||
      buildSummary(phase, completed.length, criteria.length, deliverables.length, openRisks.length),
    completedCriteria: completed.map((c) => ({ id: c.id, text: c.text, doneBy: c.doneBy, doneAt: c.doneAt })),
    overriddenCriteria: check.open.map((c) => ({ id: c.id, text: c.text })),
    deliverables,
    openRisks,
    budget: {
      bac: project.bac,
      contractType: project.contractType,
      percentComplete: work.length ? Math.round((done / work.length) * 100) : 0,
    },
  };
  const review: GateReview = {
    id: newId('gr'),
    projectId: project.id,
    phaseId: phase.id,
    gate: phase.gate,
    status: 'pending',
    requestedBy: s.user.id,
    requestedAt: now(),
    overrideNote: check.overridden ? input.overrideNote!.trim() : undefined,
    budgetShared: Boolean(input.shareBudget),
    pack,
  };
  d.gateReviews.push(review);
  const before = phase.status;
  phase.status = 'ready_for_review';
  logActivity(
    s,
    project.id,
    'gate.review_requested',
    `Gate ${phase.gate} · ${phase.name} marked ready for gate review by ${s.user.name}${
      check.overridden ? ` (${check.open.length} open criteria overridden)` : ''
    }`,
  );
  writeAudit(
    s,
    'gate.request_review',
    'gate_review',
    review.id,
    { phaseStatus: before },
    {
      phaseStatus: phase.status,
      overrideNote: review.overrideNote,
      overriddenCriteria: pack.overriddenCriteria,
      budgetShared: review.budgetShared,
    },
  );
  return redactReview(s.user, review);
}

export interface PendingGateReview {
  review: GateReview;
  projectKey: string;
  projectName: string;
  phaseName: string;
}

/** Pending reviews the signed-in user may decide (Client Sponsor of the project's org only). */
async function memListPendingReviews(s: Session): Promise<PendingGateReview[]> {
  const d = db();
  return d.gateReviews
    .filter((r) => r.status === 'pending')
    .flatMap((r) => {
      const p = d.projects.find((x) => x.id === r.projectId);
      if (!p || !canSeeProject(s.user, p, d.members) || !canDecideGate(s.user, p)) return [];
      const ph = d.phases.find((x) => x.id === r.phaseId);
      return [
        {
          review: redactReview(s.user, r),
          projectKey: p.key,
          projectName: p.name,
          phaseName: ph?.name ?? '',
        },
      ];
    });
}

export interface DecideContext {
  ip?: string;
  reauthAt: string | null;
  now?: Date;
}

async function memDecideGate(s: Session, reviewId: string, input: DecisionInput, ctx: DecideContext) {
  const d = db();
  const review = d.gateReviews.find((r) => r.id === reviewId);
  if (!review) throw new NotFoundError('Gate review not found');
  const project = requireVisibleProject(s, review.projectId);
  if (!canDecideGate(s.user, project))
    throw new ForbiddenError("Only the client's Sponsor can approve or reject a gate.");
  if (review.status !== 'pending') throw new ValidationError('This gate review has already been decided.');
  const at = ctx.now ?? new Date();
  if (!isReauthFresh(ctx.reauthAt, at)) throw new ReauthRequiredError();
  const v = validateDecision(input);
  if (!v.ok) throw new ValidationError(v.reason);
  const { decision, conditions, reason } = v.value;

  const phases = phasesOf(project.id);
  const phase = phases.find((p) => p.id === review.phaseId)!;
  const before = phases.map((p) => ({ id: p.id, status: p.status }));
  const today = at.toISOString().slice(0, 10);
  for (const ch of applyDecision(phases, phase.id, decision, today)) {
    const target = phases.find((p) => p.id === ch.id)!;
    target.status = ch.status;
    if (ch.startDate) target.startDate = ch.startDate;
    if (ch.endDate) target.endDate = ch.endDate;
  }

  Object.assign(review, {
    status: 'decided',
    decision,
    conditions,
    reason,
    decidedBy: s.user.id,
    decidedAt: at.toISOString(),
    ip: ctx.ip,
  } satisfies Partial<GateReview>);

  if (conditions?.length) {
    const next = phases.find((p) => p.gate > phase.gate);
    const created = conditionsToItems(conditions, phase.gate, next?.id ?? phase.id).map((input) =>
      systemCreateItem(s, project, input),
    );
    review.conditionItemKeys = created.map((i) => i.key);
    for (const it of created)
      logActivity(
        s,
        project.id,
        'item.created',
        `${it.key} created from a gate ${phase.gate} condition`,
        it.id,
      );
  }

  const by = nameOf(s.user.id);
  logActivity(
    s,
    project.id,
    decision === 'rejected' ? 'gate.rejected' : 'gate.approved',
    decision === 'rejected'
      ? `${phase.name} gate rejected by ${by}: ${reason}. Phase returned to active.`
      : `${phase.name} gate ${DECISION_LABEL[decision].toLowerCase()} by ${by}`,
  );
  writeAudit(
    s,
    'gate.decide',
    'gate_review',
    review.id,
    { phases: before },
    {
      decision,
      conditions,
      conditionItemKeys: review.conditionItemKeys,
      reason,
      decidedAt: review.decidedAt,
      phases: phases.map((p) => ({ id: p.id, status: p.status })),
    },
    ctx.ip,
  );
  return redactReview(s.user, review);
}

/** The demo-store implementation. */
export const memoryGateStore: GateStore = {
  getGates: memGetGates,
  addCriterion: memAddCriterion,
  updateCriterion: memUpdateCriterion,
  removeCriterion: memRemoveCriterion,
  requestReview: memRequestReview,
  listPendingReviews: memListPendingReviews,
  decideGate: memDecideGate,
};

/** The active store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const gateStore = (): GateStore => (isPostgresEnabled() ? postgresGateStore() : memoryGateStore);

// Public API used by route handlers and pages: each call goes to the active store.
export const getGates: GateStore['getGates'] = (...a) => gateStore().getGates(...a);
export const addCriterion: GateStore['addCriterion'] = (...a) => gateStore().addCriterion(...a);
export const updateCriterion: GateStore['updateCriterion'] = (...a) => gateStore().updateCriterion(...a);
export const removeCriterion: GateStore['removeCriterion'] = (...a) => gateStore().removeCriterion(...a);
export const requestReview: GateStore['requestReview'] = (...a) => gateStore().requestReview(...a);
export const listPendingReviews: GateStore['listPendingReviews'] = (...a) =>
  gateStore().listPendingReviews(...a);
export const decideGate: GateStore['decideGate'] = (...a) => gateStore().decideGate(...a);
