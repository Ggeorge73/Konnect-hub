import type { GateCriterion, Phase, PhaseStatus, Profile, Project, Visibility } from './types';
import { canSeeFinancials, isClientRole } from './permissions';

/** Konnect Delivery Framework gate rules (GATE-01, GATE-02). Pure functions only. */

export type GateDecision = 'approved' | 'approved_with_conditions' | 'rejected';

export const DECISION_LABEL: Record<GateDecision, string> = {
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
};

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  not_started: 'Not started',
  active: 'Active',
  ready_for_review: 'Ready for gate review',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
};

/** Label put on work items created from "approve with conditions". */
export const GATE_CONDITION_LABEL = 'gate-condition';
/** Gate and acceptance decisions need a re-auth no older than this. */
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export interface GatePack {
  summary: string;
  completedCriteria: { id: string; text: string; doneBy?: string; doneAt?: string }[];
  /** Criteria still open when the Lead requested review with an override note. */
  overriddenCriteria: { id: string; text: string }[];
  deliverables: { id: string; name: string; status: string; visibility: Visibility }[];
  openRisks: { id: string; title: string; score?: number; visibility: Visibility }[];
  /** Internal only. Stripped for clients unless the Lead shared it (`budgetShared`). */
  budget?: { bac: number; contractType: Project['contractType']; percentComplete: number };
}

export interface GateReview {
  id: string;
  projectId: string;
  phaseId: string;
  gate: number;
  status: 'pending' | 'decided';
  requestedBy: string;
  requestedAt: string;
  overrideNote?: string;
  budgetShared: boolean;
  pack: GatePack;
  decision?: GateDecision;
  conditions?: string[];
  /** Keys of the work items created from the conditions. */
  conditionItemKeys?: string[];
  reason?: string;
  decidedBy?: string;
  decidedAt?: string;
  ip?: string;
}

export const isPassed = (s: PhaseStatus) => s === 'approved' || s === 'approved_with_conditions';
/** A phase the team is working in: active, or sent back after a rejection. */
export const isWorkingPhase = (s: PhaseStatus) => s === 'active' || s === 'rejected';

/** The phase the gate tracker highlights: the first one not yet passed. */
export const currentPhase = (phases: Phase[]) =>
  [...phases].sort((a, b) => a.gate - b.gate).find((p) => !isPassed(p.status));

export type CheckResult =
  | { ok: true; open: GateCriterion[]; overridden: boolean }
  | { ok: false; open: GateCriterion[]; reason: string };

/**
 * Exit-criteria check run when the Lead marks a phase "Ready for gate review".
 * Any unchecked criterion blocks the request unless the Lead gives an override note.
 */
export function checkExitCriteria(criteria: GateCriterion[], overrideNote?: string): CheckResult {
  const open = criteria.filter((c) => !c.done);
  if (open.length === 0) return { ok: true, open, overridden: false };
  if (overrideNote?.trim()) return { ok: true, open, overridden: true };
  return {
    ok: false,
    open,
    reason: `${open.length} exit ${open.length === 1 ? 'criterion is' : 'criteria are'} not complete: ${open
      .map((c) => c.text)
      .join('; ')}. Tick them or add an override note.`,
  };
}

/** Leads (of this project) and Admins edit criteria and request reviews. */
export const canManageGates = (user: Profile, project: Project) =>
  user.role === 'admin' || (user.role === 'delivery_lead' && project.leadId === user.id);

/** Only the Client Sponsor of the project's own client organization decides a gate. */
export const canDecideGate = (user: Profile, project: Project) =>
  user.role === 'client_sponsor' && user.orgId === project.clientOrgId && !project.deletedAt;

export type Validation = { ok: true } | { ok: false; reason: string };

/** Criteria may be edited until the phase is under review or passed. */
export function canEditCriteria(phase: Phase): Validation {
  if (phase.status === 'ready_for_review')
    return { ok: false, reason: 'This phase is awaiting a gate decision; its criteria are locked.' };
  if (isPassed(phase.status)) return { ok: false, reason: 'This gate is already approved.' };
  return { ok: true };
}

export function canRequestReview(phase: Phase, phases: Phase[]): Validation {
  if (!isWorkingPhase(phase.status))
    return { ok: false, reason: 'Only the active phase can be marked ready for gate review.' };
  const earlier = phases.filter((p) => p.gate < phase.gate && !isPassed(p.status));
  if (earlier.length) return { ok: false, reason: 'Earlier gates must be approved first.' };
  return { ok: true };
}

export interface DecisionInput {
  decision: GateDecision;
  conditions?: string[];
  reason?: string;
}

/** Normalises and validates a sponsor decision. Conditions are required for conditional approval. */
export function validateDecision(
  input: DecisionInput,
): { ok: true; value: DecisionInput } | { ok: false; reason: string } {
  const conditions = (input.conditions ?? []).map((c) => c.trim()).filter(Boolean);
  const reason = input.reason?.trim() || undefined;
  if (input.decision === 'approved_with_conditions' && conditions.length === 0)
    return { ok: false, reason: 'Add at least one condition to approve with conditions.' };
  if (input.decision === 'rejected' && !reason)
    return { ok: false, reason: 'A reason is required to reject a gate.' };
  return {
    ok: true,
    value: {
      decision: input.decision,
      conditions: input.decision === 'approved_with_conditions' ? conditions : undefined,
      reason,
    },
  };
}

/** Phase status changes applied when a decision is recorded. */
export function applyDecision(
  phases: Phase[],
  phaseId: string,
  decision: GateDecision,
  today: string,
): { id: string; status: PhaseStatus; startDate?: string; endDate?: string }[] {
  const sorted = [...phases].sort((a, b) => a.gate - b.gate);
  const phase = sorted.find((p) => p.id === phaseId);
  if (!phase) return [];
  if (decision === 'rejected') return [{ id: phase.id, status: 'active' }];
  const out: { id: string; status: PhaseStatus; startDate?: string; endDate?: string }[] = [
    { id: phase.id, status: decision, endDate: today },
  ];
  const next = sorted.find((p) => p.gate > phase.gate);
  if (next && next.status === 'not_started') out.push({ id: next.id, status: 'active', startDate: today });
  return out;
}

/** Work items created from approval conditions: shared tasks labelled `gate-condition`. */
export function conditionsToItems(conditions: string[], gate: number, phaseId: string | null) {
  return conditions.map((text) => ({
    type: 'task' as const,
    title: text.length > 255 ? text.slice(0, 252) + '...' : text,
    description: `<p>Condition of gate ${gate} approval: ${escapeHtml(text)}</p>`,
    visibility: 'shared' as const,
    labels: [GATE_CONDITION_LABEL],
    phaseId,
    status: 'ready' as const,
    priority: 'high' as const,
  }));
}

/** Is a re-auth timestamp recent enough for an approval? */
export function isReauthFresh(reauthAt: string | null | undefined, now: Date, windowMs = REAUTH_WINDOW_MS) {
  if (!reauthAt) return false;
  const t = Date.parse(reauthAt);
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= -60_000 && age <= windowMs;
}

/** First address in X-Forwarded-For (the original client). */
export function clientIp(forwardedFor: string | null | undefined, realIp?: string | null) {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first || realIp?.trim() || undefined;
}

/** What a viewer may see of a review: clients never get internal deliverables, risks or (unshared) budget. */
export function redactReview(viewer: Profile, r: GateReview): GateReview {
  const client = isClientRole(viewer.role);
  const showBudget = canSeeFinancials(viewer) || (client && r.budgetShared);
  const pack: GatePack = {
    ...r.pack,
    deliverables: client ? r.pack.deliverables.filter((d) => d.visibility === 'shared') : r.pack.deliverables,
    openRisks: client ? r.pack.openRisks.filter((x) => x.visibility === 'shared') : r.pack.openRisks,
    budget: showBudget ? r.pack.budget : undefined,
  };
  return { ...r, pack };
}

export function buildSummary(
  phase: Pick<Phase, 'gate' | 'name'>,
  done: number,
  total: number,
  deliverables: number,
  risks: number,
) {
  return `Gate ${phase.gate} · ${phase.name}: ${done} of ${total} exit criteria complete, ${deliverables} linked deliverable${
    deliverables === 1 ? '' : 's'
  }, ${risks} open risk${risks === 1 ? '' : 's'}.`;
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
