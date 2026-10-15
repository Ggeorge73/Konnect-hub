# Konnector CRM integration

Konnector CRM ([Ggeorge73/Konnector-CRM](https://github.com/Ggeorge73/Konnector-CRM)) is where Konnector **wins** work; Konnect Hub is where it is **delivered** and the only place clients sign in. This integration connects the two.

Think of a relay race: the CRM runs the sales leg and hands the baton (a won deal) to the Hub. After that the Hub carries the project, and it calls back over its shoulder to report progress (health) and to pass on what the client decided about anything commercial the CRM sent.

Contract: [`docs/integration/crm-contract.md`](integration/crm-contract.md) (a copy of the CRM's `data-model.md`, sections "Handoff to Konnect Hub" and "Client commercial items") and the Zod schemas in `lib/integration/contract.ts`, which mirror the CRM's `src/lib/integration/contract.ts`. **Payload shapes are identical on both sides; change them only together with the CRM.**

## Transport

|             |                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM → Hub   | `POST /api/integrations/crm/events`. In the CRM set `KONNECT_HUB_BASE_URL=https://<hub>/api/integrations/crm` (the CRM posts to `{KONNECT_HUB_BASE_URL}/events`). |
| Hub → CRM   | `POST {CRM_BASE_URL}/api/integrations/konnect-hub`                                                                                                                |
| Signature   | `X-Konnector-Signature: t=<unix ms>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`; more than 5 minutes of skew is refused                                       |
| Secret      | `KONNECTOR_INTEGRATION_SECRET`, the same value on both sides (≥ 32 characters once Supabase is configured)                                                        |
| Idempotency | inbound: the CRM's `idempotency_key` (a replay returns the first answer with `idempotent_replay: true`); outbound: event + item/project + version/timestamp       |
| Retries     | outbound: 1, 2, 4, 8, 16 minutes, 6 attempts, then `dead`; a 4xx other than 408/429 fails at once. Inbound retries are the CRM's.                                 |
| Log         | every event in `integration_events` (direction, status, attempts, last error, payload); Admin → **Integrations** shows it with a Retry button                     |

Every inbound call is: signature checked → JSON parsed → **refused if any key is a cost-side field** (`unit_cost`, `margin`, `internal_notes`, …) → validated against the strict schema (unknown keys are refused) → de-duplicated → applied → logged. A refused payload is logged **without its content**, since it may hold the data it was refused for.

## Events

| Event                    | Direction | What the Hub does                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opportunity.won`        | CRM → Hub | Matches the client (by `konnect_hub_client_id`, else the CRM account id, else the name) or creates it; creates the project from the **Konnect Delivery Framework — Hybrid** template (key from the name, BAC = contract value, dates, scope); stores the contract no., service lines, acceptance headlines and documents; assigns the Delivery Lead; invites the client contacts. Returns `{ konnect_hub_client_id, konnect_hub_project_id, project_url }`. |
| `project.extended`       | CRM → Hub | Moves the target date and/or adds to the budget, with a change entry on the project (activity, audit, "Changes from the CRM").                                                                                                                                                                                                                                                                                                                              |
| `client_item.published`  | CRM → Hub | Stores the quote / amendment / renewal offer / survey for the client org (and project), supersedes older open versions of the same lineage, notifies the approvers.                                                                                                                                                                                                                                                                                         |
| `client_item.withdrawn`  | CRM → Hub | Hides it from "For your review"; an old link shows "Withdrawn by Konnector" with the reason.                                                                                                                                                                                                                                                                                                                                                                |
| `project.health_updated` | Hub → CRM | Schedule / budget / acceptance (green, amber, red), % complete and status for every handed-off project, when it changes and at least daily.                                                                                                                                                                                                                                                                                                                 |
| `client_item.viewed`     | Hub → CRM | The first time any client user opens the item.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `client_item.decided`    | Hub → CRM | Accepted / declined / changes requested, with name, title, email, time and IP.                                                                                                                                                                                                                                                                                                                                                                              |
| `survey.submitted`       | Hub → CRM | 0–10 score and optional comment.                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Roles

| CRM contact role  | Portal role    | Can                                              |
| ----------------- | -------------- | ------------------------------------------------ |
| `client_admin`    | Client Sponsor | accept, request changes, decline; answer surveys |
| `client_approver` | Client Sponsor | accept, request changes, decline; answer surveys |
| `client_member`   | Client Member  | read; answer surveys                             |
| (Hub only)        | Client Viewer  | read                                             |

The integration acts as the Admin named by `CRM_INTEGRATION_ACTOR_EMAIL` (create a dedicated "Konnector CRM" Admin profile in production) or, if unset, the first active Admin. That profile is the actor on the audit entries for orgs, projects and invites the CRM creates.

## Health rules (the Hub is the single source of truth)

`projectHealth()` in `lib/domain/crm.ts`, using the same thresholds as the dashboard RAG suggestion:

- **Schedule**: SPI below 0.8 red, below 0.95 amber (no SPI yet: green).
- **Budget**: CPI below 0.85 red, below 0.95 amber.
- **Acceptance**: a rejected deliverable, or one more than 14 days past due without acceptance, is red; any deliverable past due without acceptance is amber.
- **% complete**: earned value / BAC. **Status**: the project status.

## The portal: "For your review"

On the client's portal home and on each project page (with a badge count of what is waiting). The item page shows the title, summary, price lines (qty × unit price), total, terms, the PDF, the respond-by date and the version ("Version 2 · supersedes v1").

- **Accept**: name and job title, plus the usual "Confirm it's you" re-auth (valid 15 minutes). Email, time and IP are recorded and sent to the CRM.
- **Request changes**: a note is required. **Decline**: the note is optional.
- **Signature items** (`requires_signature`) show **Sign** (the document link) instead of Accept. Contract v1 carries no envelope status back to the Hub, so the CRM records the signature from its e-signature provider.
- **Surveys**: 0–10 and an optional comment, by Sponsors and Members.
- Approvers get an email (and in-app notification) when an item arrives and a reminder 3 days before respond-by. The project's Delivery Lead is notified of every decision.
- Konnector users see the items read-only on the project overview ("From Konnector CRM"); the contract value only for Admins and Leads; associates see none of it.

## Scheduled job

`POST /api/integrations/crm/cron` with `x-cron-secret: $CRON_SECRET`, every 15 minutes: retries due deliveries, sends health that changed (and every project at least daily) and respond-by reminders. Idempotent. See `docs/runbook.md`.

## Local development

With `CRM_BASE_URL` unset, demo mode (or `MOCK_CRM=true`) delivers Hub → CRM events to an in-process **mock CRM** (`lib/integration/mock-crm.ts`) that checks signatures, the contract and idempotency like the real webhook. `POST /api/dev/mock-crm` (demo only, 404 with Supabase) sends signed CRM → Hub events:

```bash
curl -X POST localhost:3000/api/dev/mock-crm -H 'content-type: application/json' -d '{"action":"handoff"}'
curl -X POST localhost:3000/api/dev/mock-crm -H 'content-type: application/json' \
  -d '{"action":"publish","clientId":"org_peachtree","projectId":"p_ehr"}'
curl localhost:3000/api/dev/mock-crm        # what the Hub sent the "CRM"
```

Other actions: `withdraw`, `extend`, `failNext` (make the next deliveries fail, to exercise retries), `reset`, and `raw` (any payload, signed). To run the real pair locally, start the CRM with `KONNECT_HUB_BASE_URL=http://localhost:3000/api/integrations/crm` and the Hub with `CRM_BASE_URL=http://localhost:3001` and the same `KONNECTOR_INTEGRATION_SECRET`.

## Code map

| Piece                                                    | File                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract (Zod), signing                                  | `lib/integration/contract.ts`, `lib/integration/signing.ts`                                                                                |
| Receive, apply, enqueue/deliver, health, reminders, cron | `lib/integration/service.ts`                                                                                                               |
| Transport (HTTP or mock), mock CRM                       | `lib/integration/transport.ts`, `lib/integration/mock-crm.ts`                                                                              |
| Rules (roles, health, decisions, retries)                | `lib/domain/crm.ts`                                                                                                                        |
| Stores (demo / Postgres)                                 | `lib/data/integration.ts`, `lib/data/integration-postgres.ts`                                                                              |
| Schema, RLS, decision functions                          | `supabase/migrations/0018_crm_integration.sql`                                                                                             |
| Portal                                                   | `features/portal/ForYourReview.tsx`, `ReviewItem.tsx`, `app/portal/review/[id]`                                                            |
| Admin, project panel                                     | `features/integrations/`                                                                                                                   |
| Tests                                                    | `lib/integration/integration.test.ts`, `lib/data/integration-postgres.test.ts`, `supabase/tests/rls.test.sql` §25, `tests/e2e/crm.spec.ts` |
