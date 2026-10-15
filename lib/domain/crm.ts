import { z } from 'zod';
import type { Rag, Role } from './types';
import { RAG_THRESHOLDS } from './dashboard';
import type {
  ClientContactRole,
  ClientItemDecision,
  ClientItemLine,
  ClientItemType,
} from '../integration/contract';

/**
 * Konnector CRM integration rules (docs/integration.md). Pure functions only: the stores in
 * lib/data/integration{,-postgres}.ts and the service in lib/integration/service.ts apply them.
 *
 * The CRM wins the work and owns the commercial items; the Hub runs delivery and owns project
 * health. Anything here that the CRM also computes is computed here only (health), and anything
 * the CRM owns is stored here read-only for Konnector users (items, handoff details).
 */

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

/** CRM contact roles → portal roles. Client admins and approvers are the Sponsors who decide. */
export const PORTAL_ROLE_FOR: Record<ClientContactRole, Role> = {
  client_admin: 'client_sponsor',
  client_approver: 'client_sponsor',
  client_member: 'client_member',
};

/**
 * A project key (2–10 letters or digits, starting with a letter) from the project name: the
 * initials of its words (or its first letters), plus a number if the key is taken.
 */
export function deriveProjectKey(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((k) => k.toUpperCase()));
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(THE|AND|OF|FOR|A|AN|TO)$/.test(w));
  let base = words.length >= 2 ? words.map((w) => w[0]).join('') : (words[0] ?? 'PRJ');
  base = base.replace(/^[^A-Z]+/, '');
  if (base.length < 2) base = (base + (words.join('') || 'PRJ')).replace(/^[^A-Z]+/, '');
  base = (base.length < 2 ? 'PRJ' : base).slice(0, 6);
  if (!used.has(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const k = `${base}${n}`.slice(0, 10);
    if (!used.has(k)) return k;
  }
  throw new Error('No free project key');
}

/** The project description built from the handoff (scope + service lines + contract no.). */
export function handoffDescription(p: {
  scope_summary: string;
  service_lines: string[];
  contract_no: string;
}): string {
  const lines = [p.scope_summary.trim()];
  if (p.service_lines.length) lines.push(`Service lines: ${p.service_lines.join(', ')}.`);
  if (p.contract_no) lines.push(`Contract ${p.contract_no}.`);
  return lines.filter(Boolean).join('\n\n');
}

/** What the Hub keeps from the handoff, shown read-only on the project ("Commercial" panel). */
export interface CrmProjectLink {
  projectId: string;
  crmAccountId: string;
  contractNo: string;
  value: number;
  currency: string;
  serviceLines: string[];
  scopeSummary: string;
  acceptanceCriteria: string[];
  documents: { name: string; url: string }[];
  handoffKey: string;
  createdAt: string;
  /** Last health sent to the CRM (to send only on change, and at least daily). */
  lastHealth: HealthSnapshot | null;
  lastHealthSentAt: string | null;
  /** Change entries from `project.extended`. */
  changes: CrmChangeEntry[];
}

export interface CrmChangeEntry {
  at: string;
  reason: string;
  previousEndDate: string;
  newEndDate: string | null;
  additionalValue: number | null;
  currency: string;
}

// ---------------------------------------------------------------------------
// Commercial items (quotes, amendments, renewal offers, surveys)
// ---------------------------------------------------------------------------

export type ClientItemStatus =
  'open' | 'viewed' | 'accepted' | 'declined' | 'changes_requested' | 'withdrawn' | 'superseded';

export const CLIENT_ITEM_TYPE_LABEL: Record<ClientItemType, string> = {
  quote: 'Quote',
  contract_amendment: 'Contract amendment',
  renewal_offer: 'Renewal offer',
  survey: 'Survey',
};

export const CLIENT_ITEM_STATUS_LABEL: Record<ClientItemStatus, string> = {
  open: 'Awaiting your review',
  viewed: 'Awaiting your review',
  accepted: 'Accepted',
  declined: 'Declined',
  changes_requested: 'Changes requested',
  withdrawn: 'Withdrawn by Konnector',
  superseded: 'Superseded',
};

export interface ClientItem {
  /** The CRM's item id (one per version). */
  id: string;
  lineageId: string;
  version: number;
  supersedesVersion: number | null;
  type: ClientItemType;
  orgId: string;
  projectId: string | null;
  title: string;
  summary: string | null;
  amount: number | null;
  currency: string;
  lines: ClientItemLine[];
  terms: string | null;
  newEndDate: string | null;
  respondBy: string | null;
  document: { name: string; url: string } | null;
  requiresSignature: boolean;
  status: ClientItemStatus;
  publishedAt: string;
  firstViewedAt: string | null;
  firstViewedBy: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decidedByTitle: string | null;
  decidedByEmail: string | null;
  decidedIp: string | null;
  decisionNote: string | null;
  surveyScore: number | null;
  surveyComment: string | null;
  withdrawnReason: string | null;
  remindedAt: string | null;
}

/** Still waiting on the client. */
export const isOpenItem = (i: Pick<ClientItem, 'status'>) => i.status === 'open' || i.status === 'viewed';

/** Client admins / designated approvers (portal Sponsors) decide quotes, amendments and offers. */
export const canDecideClientItem = (role: Role) => role === 'client_sponsor';

/** Surveys can be answered by any client user who can act in the portal. */
export const canAnswerSurvey = (role: Role) => role === 'client_sponsor' || role === 'client_member';

/** May this client user act on this item now? Returns a reason when not. */
export function actionBlocker(
  role: Role,
  item: Pick<ClientItem, 'status' | 'type' | 'requiresSignature'>,
): string | null {
  if (!isOpenItem(item))
    return item.status === 'withdrawn'
      ? 'This item was withdrawn by Konnector.'
      : item.status === 'superseded'
        ? 'A newer version of this item replaces it.'
        : 'This item has already been decided.';
  if (item.type === 'survey') return canAnswerSurvey(role) ? null : 'Your portal role cannot answer surveys.';
  if (!canDecideClientItem(role)) return 'Only your organization’s approvers can decide this.';
  return null;
}

/** Sum of qty × unit price, rounded to the cent. */
export const linesTotal = (lines: Pick<ClientItemLine, 'qty' | 'unit_price'>[]) =>
  Math.round(lines.reduce((s, l) => s + l.qty * l.unit_price, 0) * 100) / 100;

export const decisionSchema = z
  .object({
    decision: z.enum(['accepted', 'declined', 'changes_requested']),
    note: z.string().trim().max(4000).optional().nullable(),
    name: z.string().trim().max(200).optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'changes_requested' && !v.note)
      ctx.addIssue({ code: 'custom', message: 'Tell Konnector what should change.', path: ['note'] });
    if (v.decision === 'accepted' && !v.name)
      ctx.addIssue({ code: 'custom', message: 'Enter your full name to accept.', path: ['name'] });
    if (v.decision === 'accepted' && !v.title)
      ctx.addIssue({ code: 'custom', message: 'Enter your job title to accept.', path: ['title'] });
  });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const surveySchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().max(4000).optional().nullable(),
});
export type SurveyInput = z.infer<typeof surveySchema>;

/** The status an item takes after a decision. */
export const statusFor = (d: ClientItemDecision): ClientItemStatus => d;

const DAY_MS = 86_400_000;
export const REMINDER_DAYS_BEFORE = 3;

/** True when an open item is due its "respond by" reminder (3 days before, once). */
export function reminderDue(
  i: Pick<ClientItem, 'status' | 'respondBy' | 'remindedAt'>,
  today: string,
): boolean {
  if (!isOpenItem(i) || !i.respondBy || i.remindedAt) return false;
  const days = (Date.parse(i.respondBy) - Date.parse(today)) / DAY_MS;
  return days >= 0 && days <= REMINDER_DAYS_BEFORE;
}

export const isPastRespondBy = (i: Pick<ClientItem, 'respondBy'>, today: string) =>
  Boolean(i.respondBy && i.respondBy < today);

// ---------------------------------------------------------------------------
// Project health (the Hub is the single source of truth; the CRM only displays it)
// ---------------------------------------------------------------------------

export interface HealthSnapshot {
  health_schedule: Rag;
  health_budget: Rag;
  health_acceptance: Rag;
  percent_complete: number;
  status: string;
}

export interface HealthInputs {
  spi: number | null;
  cpi: number | null;
  percentComplete: number;
  projectStatus: string;
  /** Every deliverable of the project (internal view). */
  deliverables: { status: string; dueDate: string | null }[];
  asOf: string;
}

/** Same thresholds as the dashboard RAG suggestion (lib/domain/dashboard.ts). */
const ratioRag = (r: number | null, red: number, amber: number): Rag =>
  r === null ? 'green' : r < red ? 'red' : r < amber ? 'amber' : 'green';

/**
 * - schedule: SPI (red < 0.8, amber < 0.95);
 * - budget: CPI (red < 0.85, amber < 0.95);
 * - acceptance: red when a deliverable was rejected or is more than 14 days past due without
 *   acceptance; amber when one is past due without acceptance; otherwise green.
 */
export function projectHealth(h: HealthInputs): HealthSnapshot {
  const late = h.deliverables
    .filter((d) => d.status !== 'accepted' && d.dueDate && d.dueDate < h.asOf)
    .map((d) => (Date.parse(h.asOf) - Date.parse(d.dueDate!)) / DAY_MS);
  const acceptance: Rag =
    h.deliverables.some((d) => d.status === 'rejected') || late.some((n) => n > 14)
      ? 'red'
      : late.length
        ? 'amber'
        : 'green';
  return {
    health_schedule: ratioRag(h.spi, RAG_THRESHOLDS.red.spi, RAG_THRESHOLDS.amber.spi),
    health_budget: ratioRag(h.cpi, RAG_THRESHOLDS.red.cpi, RAG_THRESHOLDS.amber.cpi),
    health_acceptance: acceptance,
    percent_complete: Math.max(0, Math.min(100, Math.round(h.percentComplete))),
    status: h.projectStatus,
  };
}

const sameHealth = (a: HealthSnapshot, b: HealthSnapshot) =>
  a.health_schedule === b.health_schedule &&
  a.health_budget === b.health_budget &&
  a.health_acceptance === b.health_acceptance &&
  a.percent_complete === b.percent_complete &&
  a.status === b.status;

/** Send when anything changed, or at least once a day. */
export function shouldSendHealth(
  last: HealthSnapshot | null,
  lastSentAt: string | null,
  next: HealthSnapshot,
  now: Date,
): boolean {
  if (!last || !lastSentAt) return true;
  if (!sameHealth(last, next)) return true;
  return now.getTime() - Date.parse(lastSentAt) >= DAY_MS;
}

// ---------------------------------------------------------------------------
// Event log and retries
// ---------------------------------------------------------------------------

export type IntegrationDirection = 'inbound' | 'outbound';
export type IntegrationStatus = 'pending' | 'processed' | 'failed' | 'rejected' | 'dead';

export interface IntegrationEvent {
  id: string;
  direction: IntegrationDirection;
  event: string;
  idempotencyKey: string;
  status: IntegrationStatus;
  attempts: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Outbound retry backoff: 1, 2, 4, 8, 16 minutes; 6 attempts in all, then `dead`. */
export const MAX_ATTEMPTS = 6;
export const backoffMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1);

/** 4xx answers (except 408 and 429) will not get better on retry. */
export const isPermanentFailure = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

/** "$38,400.00" in the item's currency (client-facing price, not cost). */
export const formatAmount = (amount: number | null, currency: string) =>
  amount === null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(
        amount,
      );
