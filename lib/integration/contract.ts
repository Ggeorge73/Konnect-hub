/**
 * The Konnector CRM ⇄ Konnect Hub integration contract (version 1).
 *
 * Mirrors docs/integration/crm-contract.md and the CRM's own src/lib/integration/contract.ts
 * (github.com/Ggeorge73/Konnector-CRM). The shapes must stay identical on both sides: change
 * them only together with the CRM. Inbound schemas are strict, so a payload carrying any field
 * outside the contract (cost, margin, internal notes…) is rejected before anything is stored.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '1';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().nonnegative();
const currency = z.string().length(3);

// ---------------------------------------------------------------------------
// CRM → Hub
// ---------------------------------------------------------------------------

export const ClientContactRole = z.enum(['client_admin', 'client_approver', 'client_member']);
export type ClientContactRole = z.infer<typeof ClientContactRole>;

export const OpportunityWonPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal('opportunity.won'),
    idempotency_key: z.string().min(1),
    account: z
      .object({
        crm_id: z.string(),
        name: z.string(),
        type: z.string(),
        konnect_hub_client_id: z.string().nullable(),
      })
      .strict(),
    project: z
      .object({
        name: z.string(),
        contract_no: z.string(),
        value: money,
        currency,
        start_date: isoDate,
        end_date: isoDate,
        service_lines: z.array(z.string()),
        scope_summary: z.string(),
        acceptance_criteria: z.array(z.string()),
      })
      .strict(),
    delivery_lead_email: z.string().email(),
    client_contacts: z.array(
      z.object({ name: z.string(), email: z.string().email(), role: ClientContactRole }).strict(),
    ),
    documents: z.array(z.object({ name: z.string(), url: z.string().url() }).strict()),
  })
  .strict();
export type OpportunityWonPayload = z.infer<typeof OpportunityWonPayload>;

export const HandoffAck = z.object({
  konnect_hub_client_id: z.string(),
  konnect_hub_project_id: z.string(),
  project_url: z.string().url(),
});
export type HandoffAck = z.infer<typeof HandoffAck>;

export const ProjectExtendedPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal('project.extended'),
    idempotency_key: z.string(),
    konnect_hub_project_id: z.string(),
    new_end_date: isoDate.nullable(),
    additional_value: money.nullable(),
    currency,
    reason: z.string(),
  })
  .strict();
export type ProjectExtendedPayload = z.infer<typeof ProjectExtendedPayload>;

/** Client-facing item line: no cost, no margin. */
export const ClientItemLinePayload = z
  .object({ item: z.string(), description: z.string().nullable(), qty: z.number(), unit_price: money })
  .strict();
export type ClientItemLine = z.infer<typeof ClientItemLinePayload>;

export const ClientItemType = z.enum(['quote', 'contract_amendment', 'renewal_offer', 'survey']);
export type ClientItemType = z.infer<typeof ClientItemType>;

export const ClientItemPublishedPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal('client_item.published'),
    idempotency_key: z.string(),
    item: z
      .object({
        item_id: z.string(),
        lineage_id: z.string(),
        version: z.number().int().positive(),
        supersedes_version: z.number().int().positive().nullable(),
        type: ClientItemType,
        konnect_hub_client_id: z.string(),
        konnect_hub_project_id: z.string().nullable(),
        title: z.string(),
        summary: z.string().nullable(),
        amount: money.nullable(),
        currency,
        lines: z.array(ClientItemLinePayload),
        terms: z.string().nullable(),
        new_end_date: isoDate.nullable(),
        respond_by: isoDate.nullable(),
        document: z.object({ name: z.string(), url: z.string().url() }).strict().nullable(),
        requires_signature: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ClientItemPublishedPayload = z.infer<typeof ClientItemPublishedPayload>;

export const ClientItemWithdrawnPayload = z
  .object({
    version: z.literal(CONTRACT_VERSION),
    event: z.literal('client_item.withdrawn'),
    idempotency_key: z.string(),
    item_id: z.string(),
    version_no: z.number().int(),
    reason: z.string().nullable(),
  })
  .strict();
export type ClientItemWithdrawnPayload = z.infer<typeof ClientItemWithdrawnPayload>;

/** Everything the CRM may send to the Hub. */
export const CrmToHubEvent = z.discriminatedUnion('event', [
  OpportunityWonPayload,
  ProjectExtendedPayload,
  ClientItemPublishedPayload,
  ClientItemWithdrawnPayload,
]);
export type CrmToHubEvent = z.infer<typeof CrmToHubEvent>;
export type CrmToHubEventName = CrmToHubEvent['event'];

// ---------------------------------------------------------------------------
// Hub → CRM
// ---------------------------------------------------------------------------

const rag = z.enum(['green', 'amber', 'red']);

export const HealthUpdatedPayload = z.object({
  version: z.literal(CONTRACT_VERSION).optional(),
  event: z.literal('project.health_updated'),
  konnect_hub_project_id: z.string(),
  health_schedule: rag,
  health_budget: rag,
  health_acceptance: rag,
  percent_complete: z.number().min(0).max(100),
  status: z.string(),
  updated_at: z.string().datetime({ offset: true }),
});
export type HealthUpdatedPayload = z.infer<typeof HealthUpdatedPayload>;

export const ClientItemViewedPayload = z.object({
  event: z.literal('client_item.viewed'),
  item_id: z.string(),
  version: z.number().int(),
  viewed_by: z.object({ name: z.string(), email: z.string().email() }).optional(),
  viewed_at: z.string(),
});
export type ClientItemViewedPayload = z.infer<typeof ClientItemViewedPayload>;

export const ClientItemDecision = z.enum(['accepted', 'declined', 'changes_requested']);
export type ClientItemDecision = z.infer<typeof ClientItemDecision>;

export const ClientItemDecidedPayload = z.object({
  event: z.literal('client_item.decided'),
  item_id: z.string(),
  version: z.number().int(),
  decision: ClientItemDecision,
  note: z.string().nullable().optional(),
  decided_by: z.object({
    name: z.string(),
    title: z.string().nullable().optional(),
    email: z.string().email(),
  }),
  decided_at: z.string(),
  ip: z.string().nullable().optional(),
});
export type ClientItemDecidedPayload = z.infer<typeof ClientItemDecidedPayload>;

export const SurveySubmittedPayload = z.object({
  event: z.literal('survey.submitted'),
  item_id: z.string(),
  version: z.number().int(),
  score: z.number().int().min(0).max(10),
  comment: z.string().nullable().optional(),
  submitted_by: z.object({ name: z.string(), email: z.string().email() }),
  submitted_at: z.string(),
});
export type SurveySubmittedPayload = z.infer<typeof SurveySubmittedPayload>;

export const HubToCrmEvent = z.discriminatedUnion('event', [
  HealthUpdatedPayload,
  ClientItemViewedPayload,
  ClientItemDecidedPayload,
  SurveySubmittedPayload,
]);
export type HubToCrmEvent = z.infer<typeof HubToCrmEvent>;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Keys that must never appear in a payload crossing the boundary (cost-side CRM data). */
export const FORBIDDEN_KEYS =
  /^(unit_cost|cost|margin|margin_pct|internal_notes|rate_cost|total_score|scores|weights|risk_rating|sanctions_screen|pep_screen|beneficial_ownership)$/;

export function findForbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEYS.test(k) ? [`${path}.${k}`] : []),
      ...findForbiddenKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

/** Deterministic idempotency key for an outbound (Hub → CRM) event. */
export function outboundKey(e: HubToCrmEvent): string {
  switch (e.event) {
    case 'project.health_updated':
      return `${e.event}:${e.konnect_hub_project_id}:${e.updated_at}`;
    case 'client_item.viewed':
    case 'client_item.decided':
    case 'survey.submitted':
      return `${e.event}:${e.item_id}:v${e.version}`;
  }
}

/** Idempotency key for an inbound (CRM → Hub) event: the CRM's own key. */
export const inboundKey = (e: CrmToHubEvent) => `${e.event}:${e.idempotency_key}`;
