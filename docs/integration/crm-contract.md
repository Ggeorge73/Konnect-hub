> **Copied from the CRM** (`.claude/skills/konnector-crm-builder/references/data-model.md` in
> [Ggeorge73/Konnector-CRM](https://github.com/Ggeorge73/Konnector-CRM)). The sections "Handoff to Konnect Hub"
> and "Client commercial items" are the integration contract; `lib/integration/contract.ts` mirrors them. Keep
> this file in step with the CRM and change payload shapes only on both sides together. See `docs/integration.md`.

# Konnector CRM — data model, pipeline, roles and handoff

All tables: `id uuid pk`, `created_at`, `updated_at`, `created_by`, soft delete
`archived_at`. Money as `numeric(14,2)` + `currency char(3)` (default USD).

## Core CRM

- **organizations** – the tenant (Konnector LLC). Single-tenant now, column kept for later.
- **accounts** – any organization Konnector deals with.
  `type`: `government_federal | government_state | government_local | government_foreign |
private | partner_subcontractor | oem_vendor`; `sector`, `country`, `state_region`,
  `city`, `lat`, `lng`, `website`, `logo_url`, `owner_id`, `tier (A/B/C)`,
  `status (prospect | active_client | past_client | partner | dormant)`,
  `konnect_hub_client_id` (set when first project is handed off).
- **contacts** – name, title, email, phone, `role_in_buying` (decision_maker, influencer,
  procurement_officer, technical_evaluator, champion).
- **activities** – one table for the timeline: `type (note | email | call | meeting |
task | stage_change | file | handoff | system)`, `subject`, `body`, `occurred_at`,
  `related_type`, `related_id`, `account_id`.
- **tasks** – BD follow-ups only (call back, send capability statement): title, due_at,
  assignee_id, priority, status, related record. Project work lives in Konnect Hub.
- **files** – Supabase Storage path, name, size, mime, related record.
- **tags**, **record_tags**, **saved_views**, **notifications**, **mentions**,
  **audit_log** (append-only: actor, action, before/after JSON).

## Opportunities (capture pipeline)

**opportunities** – `name`, `account_id`, `owner_id`, `kind (public_bid | private_deal |
reseller_quote | staffing_placement)`, `stage`, `value`, `currency`, `probability`,
`pwin`, `expected_close`, `source (signal | referral | event | inbound | partner)`,
`service_lines[]` (implementation, systems_integration, staffing, reselling, advisory),
`next_step`, `next_step_due`, `lost_reason`.

Public-bid fields (nullable): `solicitation_no`, `agency_buyer`, `procurement_vehicle`
(Team Georgia Marketplace, SAM.gov, GSA schedule, state contract, direct), `naics`,
`set_aside`, `questions_due`, `proposal_due`, `submission_method`, `incumbent`.

Stages (default, editable in Settings):

1. **Signal** 2. **Qualify** 3. **Capture**
2. **Bid / No-Bid** – gate: completed `bid_decisions` scorecard required to leave.
3. **Proposal** 6. **Submitted**
4. **Won** → handoff wizard (below). **Lost** → `lost_reason` required.
   **No-Bid** → reason required.

**bid_decisions** – weighted criteria (strategic fit, customer relationship, competitive
position, capability/past performance, staffing availability, margin, risk), each 1–5
with weight; `total_score`, `verdict (bid | no_bid | conditional)`, `decided_by`, `notes`.

**quotes** + **quote_lines** – services and reseller quotes: item, qty, unit cost, unit
price, margin %, OEM partner account. PDF export; status `draft | sent | accepted |
declined` set by the team (e-signature integration later).

## Compliance & vetting

- **registrations** – Konnector's own: SAM UEI/CAGE, Georgia supplier registration,
  certifications (MBE/DBE/SBE etc.), insurance — expiry dates and reminders.
- **partner_vetting** – sanctions/PEP screen, beneficial ownership, anti-corruption
  certification/attestation, references, `risk_rating`, `review_due`.

## Talent bench (staffing line)

- **consultants** – skills[], certifications[], rate_cost, rate_bill, availability_from,
  location, resume file. Used for bidding ("can we staff this?") and staffing deals.
- Allocation to live projects is read from Konnect Hub, not stored here.

## BD events

- **events** – summits, expos, procurement fairs: dates, location, budget, attendees;
  **event_leads** link captured contacts → follow-up tasks.

## Handoff to Konnect Hub (the only integration point)

**handoffs** – `opportunity_id`, `status (pending | sent | acknowledged | failed)`,
`attempts`, `last_error`, `konnect_hub_project_id`, `konnect_hub_url`, `payload_version`.

Outbound (CRM → Konnect Hub) on Won, after the wizard collects: contract no., contract
value, start/end dates, delivery lead, client contacts to invite, scope summary,
acceptance criteria headlines, key documents.

```json
{
  "version": "1",
  "event": "opportunity.won",
  "idempotency_key": "<handoff id>",
  "account": { "crm_id": "...", "name": "...", "type": "government_state", "konnect_hub_client_id": null },
  "project": {
    "name": "...",
    "contract_no": "...",
    "value": 0,
    "currency": "USD",
    "start_date": "...",
    "end_date": "...",
    "service_lines": ["implementation"],
    "scope_summary": "...",
    "acceptance_criteria": ["..."]
  },
  "delivery_lead_email": "...",
  "client_contacts": [{ "name": "...", "email": "...", "role": "client_admin" }],
  "documents": [{ "name": "...", "url": "<signed URL, 7-day expiry>" }]
}
```

Signed with HMAC-SHA256 (`X-Konnector-Signature`), retried with backoff, idempotent on
`idempotency_key`.

Inbound (Konnect Hub → CRM) webhook `project.health_updated`:
`{ konnect_hub_project_id, health_schedule, health_budget, health_acceptance,
percent_complete, status, updated_at }` → stored in **project_health** (read-only in UI)
and shown as a HealthRing + "Open in Konnect Hub" link on the account and opportunity.

Build a small **mock Konnect Hub** (route handler behind a dev flag) so the whole flow
works and is tested before the real endpoint exists. If the Konnect Hub repo is
available, read it first and match its API.

## Client commercial items (CRM → Konnect Hub portal → CRM)

The CRM has no portal. When the team needs a won client to see or decide something
commercial, the CRM **publishes** it to Konnect Hub, the client acts on it in the
Konnect Hub portal, and the decision flows back.

**client_items** – `type (quote | contract_amendment | renewal_offer | survey)`,
`account_id`, `opportunity_id`, `quote_id` (nullable), `konnect_hub_client_id`,
`konnect_hub_project_id` (nullable: account-level items have none), `title`,
`summary`, `amount`, `currency`, `document_file_id` (client-facing PDF),
`respond_by`, `version`, `status (draft | published | viewed | accepted | declined |
changes_requested | expired | withdrawn)`, `decided_by_name`, `decided_by_email`,
`decided_at`, `decision_note`, `survey_score` (0–10, surveys only), `published_by`.

Rules:

- Only items a human clicks **Publish** on ever leave the CRM. Quotes must pass margin
  guardrails/executive approval first.
- The payload carries **client-facing data only**: titles, price lines, totals, terms,
  the PDF. Never unit cost, margin, internal notes, bid scores or vetting.
- A changed item is republished as a new `version`; older versions show as superseded.
- Click-accept in the portal is a record of agreement (name, title, email, time, IP).
  Where a signed contract is legally required (most government amendments), the item
  links to an e-signature envelope instead, and status follows the envelope.

Events (same signing, retry and idempotency rules as the handoff):

- CRM → Konnect Hub: `client_item.published`, `client_item.withdrawn`
- Konnect Hub → CRM: `client_item.viewed`, `client_item.decided`
  `{ item_id, version, decision (accepted | declined | changes_requested), note,
decided_by: { name, title, email }, decided_at, ip }`, `survey.submitted`

On decision, the CRM:

- writes a timeline activity and notifies the owner;
- `quote` accepted → quote `accepted`, linked opportunity → **Won** (handoff runs if
  there is no project yet);
- `renewal_offer` or `contract_amendment` accepted → renewal/amendment opportunity
  → Won, and sends `project.extended` (new end date/value) to Konnect Hub;
- `changes_requested` → task for the owner with the client's note;
- `survey` → score stored on the account; low scores (≤6) alert the account owner.

A daily job marks items past `respond_by` as `expired` and nudges the owner.

## Roles and row-level security (internal users only)

| Role            | Scope                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `admin`         | everything, settings, users, audit log                                                           |
| `executive`     | read all; approve bid/no-bid, discounts and margins below threshold                              |
| `bd`            | accounts, contacts, opportunities and quotes they own or are shared on; no consultant cost rates |
| `delivery_lead` | read accounts/opportunities; run the handoff wizard; read bench                                  |
| `recruiter`     | consultants and staffing opportunities                                                           |

- RLS on every table via `has_role()` and ownership/sharing checks.
- `quote_lines.unit_cost`, margins, `consultants.rate_cost`, `bid_decisions` and
  `partner_vetting` readable only by admin/executive (plus the owner where noted).
- Tests log in as each role and assert what they can and cannot read.
