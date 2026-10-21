# Progress

## Konnector CRM integration (add-on)

Built from the CRM kit's `docs/kit/KONNECT_HUB_ADDON_PROMPT.md`. Details in [`integration.md`](integration.md).

- [x] **Foundation:** `/api/integrations/crm/events` with HMAC `X-Konnector-Signature` (5-minute window), idempotency on the CRM's key, every inbound and outbound event in `integration_events`; outbound signed the same way with 1-2-4-8-16 minute retries; Admin → Integrations (events, failures, Retry, "Send project health now"); mock CRM for local work and tests.
- [x] **Handoff (`opportunity.won`):** client matched or created, project from the hybrid template, contract details and documents kept read-only, Delivery Lead assigned, client contacts invited; returns the client id, project id and URL. `project.extended` moves the end date / adds value with a change entry.
- [x] **Health (`project.health_updated`):** schedule (SPI), budget (CPI), acceptance (late or rejected deliverables), % complete and status; sent on change and at least daily by the integration cron.
- [x] **"For your review" in the portal:** quotes, amendments, renewal offers and surveys with badge counts on the portal home and project page; item page with price lines, total, terms, PDF, respond-by and version; Accept (name, title, re-auth; email, time and IP recorded), Request changes (note), Decline; Sign for signature items; 0–10 surveys; withdrawn and superseded states; `client_item.viewed` / `decided` / `survey.submitted` back to the CRM; emails to approvers, a reminder 3 days before respond-by, notification to the Lead.
- [x] **Security and tests:** strict contract schemas plus a cost-field guard (payloads outside the contract are refused and not stored); RLS on the four new tables and decision functions (`rls.test.sql` §25); unit tests on the demo store, the same flow on Postgres, and Playwright end to end against the mock CRM in both themes at desktop and phone widths.
