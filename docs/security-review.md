# Security review — KH-47 [SEC-03] (PI-1 Sprint 5, Team Shield)

Scope: the whole app at the Sprint 4 integration point (`claude/vibrant-dijkstra-th2ebk`): route
handlers, middleware, session and auth, the data layer's authorization, Postgres RLS, headers,
dependencies and client bundles. Method: a manual pass over every route handler and the session /
data paths, the `security-review` checklist (injection, authn/authz, CSRF, XSS, secrets, crypto,
DoS, supply chain), then automated tests that keep the result true (listed per finding and in
[Tests](#tests)).

## Summary

| Severity  | Found | Fixed | Accepted / documented |
| --------- | ----: | ----: | --------------------: |
| Critical  |     0 |     0 |                     0 |
| High      |     3 |     3 |                     0 |
| Medium    |     6 |     6 |                     0 |
| Low       |     6 |     5 |                     1 |
| Info      |     5 |     0 |                     5 |
| **Total** |    20 |    14 |                     6 |

No finding allowed one client organization to read another's data: tenant isolation held in both
the demo store and Postgres RLS, and the new every-route tests now prove it per route.

## Findings

| ID   | Severity | Area                   | Finding                                                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                        | Test                                                                                                   |
| ---- | -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| F-01 | High     | Re-auth for approvals  | `app/api/reauth/route.ts`: with Supabase Auth on, "Confirm it's you" only re-typed the signed-in user's email. That proves nothing, so the 15-minute re-auth that makes gate and acceptance sign-offs defensible (CLAUDE.md §4) was not enforced in production.                                 | Supabase mode now verifies the password with a throw-away, non-persisting Supabase client (`lib/auth/reauth-verify.ts`), or accepts a sign-in that itself happened within the 15-minute window (magic-link / Google / Microsoft users sign in again). The dialog asks for the password in Supabase mode. Demo mode is unchanged. Rate limited to 10/min.   | `tests/e2e/security.spec.ts` (rate limit on re-auth); `lib/data/contract-gates.ts` (decision needs it) |
| F-02 | High     | Secrets                | `lib/reauth.ts`, `lib/ics/token.ts`: `REAUTH_SECRET` and `ICS_SECRET` silently fell back to `'dev-secret'` in every mode. In a production deployment that forgot them, anyone could mint a calendar token for any user and project (read that user's milestone feed) or forge a re-auth cookie. | `lib/security/secrets.ts` `serverSecret()`: the fallback applies in demo mode only. With Supabase Auth configured a missing or short (< 32 chars) key throws, so the feature fails closed (ICS: 404, approvals: 500 logged).                                                                                                                               | `lib/security/secrets.test.ts`                                                                         |
| F-03 | High     | Dependencies           | `npm audit --omit=dev`: `postcss <= 8.5.22` (GHSA-qx2v-qp2m-jg93 and three source-map path issues), pulled in by `next@15.5.27` (pinned `postcss@8.4.31`). Only reachable at build time on first-party CSS, so real exposure is low, but it is reported High.                                   | `package.json` `overrides.postcss: ^8.5.29` (lockfile now resolves 8.5.30 for every consumer). `npm audit --omit=dev` reports 0. CI runs `npm run audit:prod` (`--audit-level=high`).                                                                                                                                                                      | CI step "Production dependency audit"                                                                  |
| F-04 | Medium   | Stored XSS             | `features/reports/PortalReports.tsx` renders report sections with `dangerouslySetInnerHTML`, and `PATCH /api/reports/[id]` accepted any HTML. A Lead's (or a compromised Lead account's) crafted section would run script in every client user's portal session.                                | `lib/security/sanitize-html.ts`: allowlist sanitizer (editor tags only, every attribute stripped, `href` only for http(s)/mailto/relative, script-like elements dropped with their content). Applied at write (zod transform in `lib/report-schemas.ts`) and again at render. The nonce CSP (F-05) also blocks inline handlers.                            | `lib/security/sanitize-html.test.ts`                                                                   |
| F-05 | Medium   | CSP                    | `next.config.ts`: `script-src 'self' 'unsafe-inline'`, so any HTML injection could execute inline script.                                                                                                                                                                                       | Nonce-based CSP per request in `middleware.ts` (`lib/security/request-guard.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. The root layout reads `headers()` so every page renders dynamically and Next.js stamps the nonce on its scripts. See [CSP decisions](#csp-decisions). | `tests/e2e/security.spec.ts` "security headers" (headers, fresh nonce per response, no CSP violations) |
| F-06 | Medium   | CSRF                   | No route checked `Origin` / `Sec-Fetch-Site`. SameSite=Lax cookies blocked most cross-site posts, but not same-site (sibling subdomain) attackers or older browsers.                                                                                                                            | `middleware.ts` refuses non-GET/HEAD/OPTIONS requests whose `Sec-Fetch-Site` is `cross-site`/`same-site` or whose `Origin` host differs from the request host (403). Exempt: the cron endpoints and the ICS feed (no cookies). Requests with neither header are not from a browser page and pass.                                                          | `lib/security/request-guard.test.ts`; e2e "CSRF" (API and a real cross-origin form post)               |
| F-07 | Medium   | Rate limiting          | No rate limits anywhere: re-auth email/password guessing, ICS token probing, invite email flooding and export CPU exhaustion were unbounded.                                                                                                                                                    | `lib/security/rate-limit.ts`: pluggable limiter (in-memory sliding-window log by default, `RateLimitStore` interface for Upstash/Redis), applied in `middleware.ts` before any handler, 429 + `Retry-After`. Policies in [Rate limits](#rate-limits).                                                                                                      | `lib/security/rate-limit.test.ts`; e2e "rate limiting" (re-auth, ICS)                                  |
| F-08 | Medium   | Preview (CLAUDE.md §2) | "View as client" preview did not exist; Admins previewed by switching to a client persona (demo only), which is neither read-only nor audited.                                                                                                                                                  | Implemented on the session layer: `Session.impersonation`, signed `kh_preview` cookie bound to the Admin (`lib/security/preview.ts`), read-only enforced in middleware for every write (API, pages, server actions) except "Exit preview" and sign-out, `preview.start` / `preview.stop` audited, banner on every portal page, card on /admin.             | `lib/security/preview.test.ts`; e2e "View as client" (every write route 403, data unchanged, audit)    |
| F-09 | Medium   | Authn on API routes    | `lib/api.ts` `handle()` resolved the session with the page helper, so in Supabase mode an API call without a session got a 307 redirect to the HTML sign-in page instead of a 401, and the two PDF routes (`acceptance-record`, `dashboard.pdf`) swallowed that redirect into a 500.            | `getApiSession()` (`lib/session.ts`) throws `UnauthorizedError` (401 JSON) for missing, expired or not-yet-MFA sessions; used by `handle()`, `handleFile()` and every route that resolves the session itself.                                                                                                                                              | `lib/security/routes.test.ts` (every route, every method, Supabase mode without a session)             |
| F-10 | Low      | Audit log integrity    | `audit_log_insert` lets a signed-in user append rows attributed to themselves, including through PostgREST with the public anon key, and they could set `at` to any time, forging the log's order.                                                                                              | `supabase/migrations/0016_shield_hardening.sql`: `audit_log_stamp` trigger sets `at = now()` for rows written as `authenticated`/`anon`; owner and security-definer writers keep their time.                                                                                                                                                               | `supabase/tests/rls.test.sql` section 23                                                               |
| F-11 | Low      | Cron secret            | `app/api/raid/escalate/route.ts` compared `x-cron-secret` with `===` (timing side channel); both cron routes accepted any non-empty `CRON_SECRET`.                                                                                                                                              | `lib/security/cron.ts` `cronAuthorized()`: constant-time compare of SHA-256 digests; closed when `CRON_SECRET` is unset or shorter than 16 characters. Used by both cron routes.                                                                                                                                                                           | `lib/security/secrets.test.ts`                                                                         |
| F-12 | Low      | Input validation       | `POST /api/session` parsed its body with `.parse()` outside any handler, so a malformed body was an uncaught 500.                                                                                                                                                                               | `safeParse` with a 400; `GET /api/session` now goes through `handle()` (401 in Supabase mode).                                                                                                                                                                                                                                                             | `lib/security/routes.test.ts`; e2e matrix                                                              |
| F-13 | Low      | Headers                | `Permissions-Policy` covered camera, microphone and geolocation only; no `Cross-Origin-Opener-Policy`.                                                                                                                                                                                          | Added `payment=()`, `usb=()` and `Cross-Origin-Opener-Policy: same-origin` (`next.config.ts`).                                                                                                                                                                                                                                                             | e2e "security headers"                                                                                 |
| F-14 | Low      | Sign-out               | `POST /auth/sign-out` left the `kh_reauth` cookie behind, so a fresh re-auth could outlive the session on a shared machine (until it expired at 15 minutes).                                                                                                                                    | Sign-out clears `kh_reauth` and `kh_preview`.                                                                                                                                                                                                                                                                                                              | Manual (Supabase mode only)                                                                            |
| F-15 | Low      | Rate-limit identity    | The limiter and the audit IP use the first `X-Forwarded-For` hop. Behind Vercel this header is set by the platform; self-hosted without a proxy that overwrites it, a caller can rotate it to dodge limits and spoof the audited IP.                                                            | **Accepted**: deploy target is Vercel (documented in `lib/security/rate-limit.ts` `clientKey`). Revisit if self-hosting.                                                                                                                                                                                                                                   | —                                                                                                      |
| F-16 | Info     | Demo mode              | Demo mode has no sign-in: a request without a cookie is the default persona (`u_lead`), the persona cookie is unsigned, and `/api/dev/outbox` shows every outgoing email. By design; all three are off as soon as Supabase Auth is configured (outbox and persona switch answer 404).           | None (documented). Never expose a demo deployment to real data.                                                                                                                                                                                                                                                                                            | `tests/e2e/security.spec.ts` "demo mode always has a persona"                                          |
| F-17 | Info     | ICS tokens             | Calendar feed tokens are long-lived bearer URLs (calendar apps cannot sign in). Rotating `ICS_SECRET` revokes all of them; there is no per-user revocation.                                                                                                                                     | None for V1; per-user token versions are a V2 option.                                                                                                                                                                                                                                                                                                      | `lib/ics/ics.test.ts`                                                                                  |
| F-18 | Info     | Query parameters       | `GET /api/items` and `GET /api/search` cast `visibility` from the query string without zod. Harmless: the data layer applies `visibleItem()` / RLS before the filter, so a client asking for `visibility=internal` gets nothing internal.                                                       | None; covered by the cross-tenant e2e matrix, which sends `visibility=internal`.                                                                                                                                                                                                                                                                           | e2e matrix                                                                                             |
| F-19 | Info     | Rate limiter scope     | The in-memory store is per server instance. On a multi-instance (serverless) deployment each instance enforces the limits on its share of traffic.                                                                                                                                              | Swap in a shared store with `setRateLimitStore()` (Upstash/Redis) when traffic warrants it; the interface is in place.                                                                                                                                                                                                                                     | `lib/security/rate-limit.test.ts` (async backend through the same interface)                           |
| F-20 | Info     | Preview in Postgres    | The preview renders as a real profile of the chosen org and role (so RLS applies exactly), which means the Admin also sees that person's own notifications while previewing.                                                                                                                    | Accepted: Admins can read everything anyway, it is read-only and audited.                                                                                                                                                                                                                                                                                  | —                                                                                                      |

## Authorization on every route handler

Every route handler is listed below (78 at review time). "Session" is how the caller is
identified; "Object authz" is where the per-object check happens. All `lib/data/*` functions take
the `Session` and filter with `canSeeProject` + `canSeeVisibility` (demo store) or run as the user
under RLS (Postgres), throwing `NotFoundError`/`ForbiddenError`. "Zod" marks a mutating route's body
schema (— means the route takes no body).

Public by design: the ICS feed (signed per-user, per-project token) and the two cron endpoints
(`x-cron-secret`). Everything else requires a session: in Supabase mode a missing one is a 401
(`getApiSession`), proven for every route and method by `lib/security/routes.test.ts`.

| Route                                          | Methods           | Session                     | Object authz (data layer)                                                | Zod (writes)                        |
| ---------------------------------------------- | ----------------- | --------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `/api/admin/audit`                             | GET               | `handle`                    | `listAudit` → `requireAuditReader` (Admin)                               | query: `auditQuerySchema`           |
| `/api/admin/integrations`                      | GET               | `handle`                    | Admin only; `listEvents` (RLS: Admin)                                    | —                                   |
| `/api/admin/integrations/[id]/retry`           | POST              | `handle`                    | `retryEvent` (Admin)                                                     | —                                   |
| `/api/admin/integrations/health`               | POST              | `handle`                    | Admin only; `syncHealth`                                                 | —                                   |
| `/api/capacity/allocations`                    | PUT               | `handle`                    | `capacityStore().setAllocation` (Lead of project / Admin)                | `allocationSchema`                  |
| `/api/capacity/grid`                           | GET               | `handle`                    | `capacityStore().getGrid` (internal; redacted)                           | —                                   |
| `/api/dashboards/portfolio`                    | GET               | `handle`                    | `getPortfolio` (403 Associates and clients)                              | —                                   |
| `/api/deliverables/[id]`                       | PATCH             | `handle`                    | `updateDeliverable` (manager of the project)                             | `deliverablePatchSchema`            |
| `/api/deliverables/[id]/criteria/[cid]/decide` | POST              | `handle` + re-auth          | `decideCriterion` (client of the org; fresh re-auth; RLS + RPC)          | `criterionDecisionSchema`           |
| `/api/deliverables/[id]/submit`                | POST              | `handle`                    | `submitDeliverable` (manager)                                            | —                                   |
| `/api/deliverables/pending`                    | GET               | `handle`                    | `listAwaitingAcceptance` (caller's own)                                  | —                                   |
| `/api/demo`                                    | DELETE            | `handle`                    | `repo.deleteDemoProject` (Admin)                                         | —                                   |
| `/api/dev/mock-crm`                            | GET, POST         | none (demo only)            | 404 whenever Supabase is configured (like F-16)                          | `simulate` (POST)                   |
| `/api/dev/outbox`                              | GET               | none (demo only)            | 404 whenever Supabase is configured (F-16)                               | —                                   |
| `/api/exports/[entity]`                        | GET               | `handleFile`                | `runExport` per entity (same filters as the list views; audited)         | query: `isExportFormat`, entity set |
| `/api/gates/pending`                           | GET               | `handle`                    | `listPendingReviews` (caller's own)                                      | —                                   |
| `/api/gates/reviews/[id]/decide`               | POST              | `handle` + re-auth          | `decideGate` (Client Sponsor of the org; fresh re-auth; RLS + RPC)       | `decisionSchema`                    |
| `/api/integrations/crm/cron`                   | POST              | `x-cron-secret` or `handle` | Admin (or the scheduler); `runCron`                                      | —                                   |
| `/api/integrations/crm/events`                 | POST              | **HMAC signature**          | `receive`: signature, contract (strict + cost-field guard), idempotency  | CRM contract schemas                |
| `/api/items`                                   | GET, POST         | `handle`                    | `repo.listItems` / `createItem` (visible projects; internal writers)     | `createItemSchema`                  |
| `/api/items/[key]`                             | GET, PATCH        | `handle`                    | `repo.getItem` / `updateItem` (visibility; Accepted rule)                | `itemPatchSchema`                   |
| `/api/items/[key]/comments`                    | POST              | `handle`                    | `repo.addComment` (item visible; clients shared only)                    | `commentSchema`                     |
| `/api/items/[key]/time`                        | GET               | `handle`                    | `itemTime` (internal only)                                               | —                                   |
| `/api/items/[key]/watch`                       | GET, PUT          | `handle`                    | `repo.getItem` first, then own watch row                                 | `z.object({ watching })`            |
| `/api/items/bulk`                              | POST              | `handle`                    | `repo.bulkUpdate` (each item checked)                                    | `bulkSchema`                        |
| `/api/notifications`                           | GET, PATCH        | `handle`                    | caller's own rows                                                        | `markReadSchema`                    |
| `/api/notifications/digest`                    | POST              | **cron secret**             | `cronAuthorized` (constant time); CSRF-exempt                            | —                                   |
| `/api/notifications/preferences`               | GET, PATCH        | `handle`                    | caller's own prefs                                                       | `z.record(kind, channel)`           |
| `/api/onboarding`                              | GET               | `handle`                    | `requireAdmin`                                                           | —                                   |
| `/api/onboarding/clients`                      | POST              | `handle`                    | `createClientOrg` (Admin)                                                | `clientOrgSchema`                   |
| `/api/onboarding/complete`                     | POST              | `handle`                    | `completeOnboarding` (Admin)                                             | —                                   |
| `/api/onboarding/invites`                      | GET, POST         | `handle`                    | `listInvites` / `invite` (Admin; Leads for their clients)                | `inviteSchema`                      |
| `/api/onboarding/reset`                        | POST              | `handle` (demo only)        | 404 outside demo; `resetOnboarding` (Admin)                              | —                                   |
| `/api/onboarding/workspace`                    | PUT               | `handle`                    | `updateWorkspace` (Admin)                                                | `workspaceSchema`                   |
| `/api/orgs`                                    | GET               | `handle`                    | `repo.listOrgs` (clients: own org + Konnector)                           | —                                   |
| `/api/people`                                  | GET               | `handle`                    | `repo.listPeople` (redacted; clients: own org + Konnector)               | —                                   |
| `/api/people/[id]`                             | GET, PATCH        | `handle`                    | `capacityStore().getPerson` / `updatePerson` (403 clients)               | `personPatchSchema`                 |
| `/api/people/directory`                        | GET               | `handle`                    | `listDirectory` (403 clients; redacted)                                  | —                                   |
| `/api/portal/inbox`                            | GET               | `handle`                    | `getApprovalInbox` (caller's own)                                        | —                                   |
| `/api/portal/review`                           | GET               | `handle`                    | `listItems` (caller's org; RLS)                                          | —                                   |
| `/api/portal/review/[id]`                      | GET               | `handle`                    | `openItem` (caller's org; first open → `client_item.viewed`)             | —                                   |
| `/api/portal/review/[id]/decide`               | POST              | `handle` + re-auth (accept) | `decideItem` (Sponsor of the org; `client_item_decide` RPC)              | `decisionSchema` (crm)              |
| `/api/portal/review/[id]/survey`               | POST              | `handle`                    | `answerSurvey` (Sponsor/Member of the org; RPC)                          | `surveySchema`                      |
| `/api/projects`                                | GET, POST         | `handle`                    | `repo.listProjects` / `createProject` (Admin, Lead)                      | `createProjectSchema`               |
| `/api/projects/[key]`                          | GET               | `handle`                    | `repo.getProjectBundle` (canSeeProject, redacted)                        | —                                   |
| `/api/projects/[key]/acceptance-record`        | GET               | `getApiSession`             | `buildAcceptanceRecord` (visible project; audited)                       | —                                   |
| `/api/projects/[key]/activity`                 | GET               | `handle`                    | `repo.listActivity` (clients shared only)                                | —                                   |
| `/api/projects/[key]/calendar`                 | GET               | `handle`                    | `calendarPath` (visible project)                                         | —                                   |
| `/api/projects/[key]/calendar.ics`             | GET               | **feed token**              | `verifyCalendarToken` + that user's visibility; any failure 404          | —                                   |
| `/api/projects/[key]/commercial`               | GET               | `handle`                    | `getProjectCommercial` (internal, not associates; value: Admin/Lead)     | —                                   |
| `/api/projects/[key]/dashboard`                | GET, PATCH        | `handle`                    | `getDashboard` (redacted per role) / RAG + budget sharing (Lead, Admin)  | `dashboardPatchSchema`              |
| `/api/projects/[key]/dashboard.pdf`            | GET               | `getApiSession`             | `getDashboard` (redacted; audited)                                       | —                                   |
| `/api/projects/[key]/dashboard/audit`          | GET               | `handle`                    | `listDashboardAudit` (Lead, Admin)                                       | —                                   |
| `/api/projects/[key]/deliverables`             | GET, POST         | `handle`                    | `listDeliverables` (clients shared) / `createDeliverable` (manager)      | `deliverableCreateSchema`           |
| `/api/projects/[key]/export.json`              | GET               | `handleFile`                | `buildProjectExport` (Admin or the project's Lead; audited)              | —                                   |
| `/api/projects/[key]/gates`                    | GET               | `handle`                    | `getGates` (visible project)                                             | —                                   |
| `/api/projects/[key]/gates/criteria`           | POST              | `handle`                    | `addCriterion` (manager)                                                 | `criterionCreateSchema`             |
| `/api/projects/[key]/gates/criteria/[id]`      | PATCH, DELETE     | `handle`                    | `updateCriterion` / `removeCriterion` (manager)                          | `criterionPatchSchema`              |
| `/api/projects/[key]/gates/request`            | POST              | `handle`                    | `requestReview` (manager)                                                | `requestReviewSchema`               |
| `/api/projects/[key]/metrics`                  | GET               | `handle`                    | `getProjectMetrics` (internal only)                                      | —                                   |
| `/api/projects/[key]/restricted`               | PATCH             | `handle`                    | `setRestricted` (manager; U.S.-person rule)                              | `restrictedSchema`                  |
| `/api/projects/[key]/team`                     | GET, POST         | `handle`                    | `getTeam` / `assignMember` (manager; U.S.-person rule)                   | `assignSchema`                      |
| `/api/projects/[key]/team/[userId]`            | DELETE            | `handle`                    | `removeMember` (manager)                                                 | —                                   |
| `/api/projects/[key]/team/preview`             | POST              | `handle`                    | `previewAssignment` (manager)                                            | `previewSchema`                     |
| `/api/projects/[key]/timeline`                 | GET, PATCH        | `handle`                    | `getTimeline` / `reschedule` (manager)                                   | `rescheduleSchema`                  |
| `/api/raid`                                    | GET, POST         | `handle`                    | `listRaid` (clients shared) / `createRaid` (internal)                    | `createRaidSchema`                  |
| `/api/raid/[id]`                               | GET, PATCH        | `handle`                    | `getRaid` / `updateRaid` (closure note rule)                             | `raidPatchSchema`                   |
| `/api/raid/escalate`                           | POST              | **cron secret** or `handle` | `cronAuthorized`, else `escalateStaleIssues(session)` (visible projects) | —                                   |
| `/api/realtime`                                | GET (SSE)         | `getApiSession`             | `getProjectBundle` first; clients only receive shared-item events        | query: `projectId` required         |
| `/api/realtime/presence`                       | POST, DELETE      | `handle`                    | `repo.getItem` first (no presence on items the caller can't see)         | `z.object({ itemKey })`             |
| `/api/reauth`                                  | GET, POST         | `handle`                    | own re-auth only; Supabase: password or fresh sign-in (F-01)             | `reauthSchema`                      |
| `/api/reports`                                 | GET, POST         | `handle`                    | `listReports` (clients published only) / `generateDraft` (manager)       | `generateReportSchema`              |
| `/api/reports/[id]`                            | GET, PATCH        | `handle`                    | `getReport` / `updateReport` (manager; HTML sanitized, F-04)             | `reportPatchSchema`                 |
| `/api/reports/[id]/publish`                    | GET, POST         | `handle`                    | `publishCheck` / `publishReport` (Lead, Admin)                           | `publishReportSchema`               |
| `/api/reports/grid`                            | GET               | `handle`                    | `reportGrid` (internal)                                                  | —                                   |
| `/api/search`                                  | GET               | `handle`                    | `repo.search` (visible projects and items)                               | —                                   |
| `/api/session`                                 | GET, POST         | `handle` / demo only        | own session; POST (persona switch) 404 when Supabase is configured       | `switchSchema`                      |
| `/api/session/mfa`                             | POST              | Supabase claims (aal2)      | `mark_mfa_enabled()` touches the caller's row only                       | —                                   |
| `/api/session/preview`                         | GET, POST, DELETE | `handle` + real session     | Admin only; subject must be a client of that org and role                | `previewStartSchema`                |
| `/api/sprints`                                 | GET, POST         | `handle`                    | `listSprints` / `createSprint` (internal writers)                        | `createSprintSchema`                |
| `/api/sprints/[id]`                            | PATCH             | `handle`                    | `updateSprint`                                                           | `sprintPatchSchema`                 |
| `/api/sprints/[id]/complete`                   | POST              | `handle`                    | `completeSprint`                                                         | `completeSprintSchema`              |
| `/api/sprints/[id]/start`                      | POST              | `handle`                    | `startSprint`                                                            | —                                   |
| `/api/sprints/settings`                        | PUT               | `handle`                    | `setHoursPerPoint` (manager)                                             | `settingsSchema`                    |
| `/api/time`                                    | GET, POST         | `handle`                    | `listWeek` (own) / `logTime` (internal; associates on assigned projects) | `logTimeSchema`                     |
| `/api/time/[id]`                               | PATCH, DELETE     | `handle`                    | `updateTime` / `deleteTime` (own draft or rejected entry)                | `timePatchSchema`                   |
| `/api/time/approvals`                          | GET, POST         | `handle`                    | `listApprovals` / `decideTime` (Lead of the project, Admin)              | `decideTimeSchema`                  |
| `/api/time/submit`                             | POST              | `handle`                    | `submitWeek` (own)                                                       | `submitWeekSchema`                  |

Route handlers outside `app/api`: `/auth/callback` (GET; exchanges the PKCE code, then lets in only
an invited profile; rate limited) and `/auth/sign-out` (POST only; clears the Supabase session,
`kh_reauth` and `kh_preview`).

**Input validation.** Every mutating route that takes a body parses it with zod (column above).
The routes marked "—" take no body: their only input is the path id, which the data layer looks up
(unknown ids are 404; Postgres coerces non-uuids to a null uuid).

## Automated "every route" tests

Both suites list the routes from the filesystem (`app/api/**/route.ts`), so a new route is covered
without editing them.

1. **No session** — `lib/security/routes.test.ts` (Vitest, Supabase mode simulated: Supabase is
   configured and `getClaims()` returns no claims). Every exported method of every route must
   answer 401, or 404 for the documented non-session routes (`dev/outbox`, `dev/mock-crm`,
   `onboarding/reset`, `session/mfa`, the ICS feed, and `integrations/crm/events`, which is
   authenticated by the CRM's HMAC signature instead of a session), with no seed data in the body
   and no cookie set.
2. **Client of the other org** — `tests/e2e/security.spec.ts` (Playwright, demo mode). As the
   Riverbend sponsor, every method of every route is called with Peachtree object keys (project
   `EHR`, item `EHR-1`, deliverable `dl_ehr_1`, criterion `dlc_ehr_1_1`, gate review `gr_ehr_1`,
   RAID `rd_ehr_1`, sprint `s_ehr1`, report `sr_ehr_1005`, time entry `te_1`, person `u_sponsor`)
   and Peachtree query parameters. Each answer must be 401/403/404 (400 allowed for writes), or a
   2xx only for the routes scoped to the caller themselves (own notifications, own session, own
   lists); and no body may contain Peachtree data. A control test checks the same keys do resolve
   for the Peachtree sponsor, so the probe is not vacuous. Two demo-only routes are left out of
   the matrix: `POST /api/session` (persona switch, the demo's sign-in) and `GET /api/dev/outbox`
   (shows every outgoing email by design, F-16); both answer 404 once Supabase is configured, which
   suite 1 checks.
3. **Database side** — `supabase/tests/rls.test.sql` section 23: the Riverbend sponsor reads zero
   EHR rows from every project-scoped table.

**Why demo mode cannot test "no session".** Demo mode has no sign-in: the persona cookie picks a
seed user and its absence means the default persona (`u_lead`). That is asserted in the e2e file,
and the unauthenticated case is covered for every route by suite 1 instead.

## Rate limits

`middleware.ts` applies `lib/security/rate-limit.ts` before any handler, keyed by policy and client
IP (first `X-Forwarded-For` hop). Over the limit: `429`, `Retry-After: <seconds>`,
`X-RateLimit-Limit`, JSON `{ error, policy }`.

| Policy   | Limit / min | Applies to                                                                                   |
| -------- | ----------: | -------------------------------------------------------------------------------------------- |
| reauth   |          10 | `POST /api/reauth`                                                                           |
| auth     |          60 | `POST /api/session` (persona switch), `/api/session/mfa`, `/auth/callback`, `/auth/sign-out` |
| preview  |          30 | `POST`/`DELETE /api/session/preview`                                                         |
| public   |          60 | ICS feed, `POST /api/notifications/digest`, `POST /api/raid/escalate`                        |
| invite   |          20 | `POST /api/onboarding/invites`, `/api/onboarding/reset`                                      |
| export   |          30 | `/api/exports/*`, `export.json`, `dashboard.pdf`, `acceptance-record`                        |
| mutation |         600 | every other `POST`/`PUT`/`PATCH`/`DELETE` under `/api`                                       |

Backend: `MemoryRateLimitStore` (exact sliding-window log, swept, capped at 50k keys). For a shared
limit across instances implement `RateLimitStore.hit()` on Upstash/Redis (sorted set per key:
`ZREMRANGEBYSCORE`, `ZADD`, `ZCARD` in one `MULTI`) and call `setRateLimitStore()` at startup.
`KH_RATE_LIMIT=off` disables limiting for local load tests only.

## Security headers

| Header                     | Value                                                                                                                                                                                                                             | Where            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Content-Security-Policy    | per request: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'unsafe-inline' fonts`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self' *.supabase.co` | `middleware.ts`  |
| Strict-Transport-Security  | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                    | `next.config.ts` |
| X-Frame-Options            | `DENY`                                                                                                                                                                                                                            | `next.config.ts` |
| X-Content-Type-Options     | `nosniff`                                                                                                                                                                                                                         | `next.config.ts` |
| Referrer-Policy            | `strict-origin-when-cross-origin`                                                                                                                                                                                                 | `next.config.ts` |
| Permissions-Policy         | `camera=(), microphone=(), geolocation=(), payment=(), usb=()`                                                                                                                                                                    | `next.config.ts` |
| Cross-Origin-Opener-Policy | `same-origin`                                                                                                                                                                                                                     | `next.config.ts` |
| X-Powered-By               | removed (`poweredByHeader: false`)                                                                                                                                                                                                | `next.config.ts` |

### CSP decisions

- **Scripts: nonce + `'strict-dynamic'`, no `'unsafe-inline'`.** Next 15 reads the nonce from the
  CSP request header that middleware sets and stamps it on its own scripts. This needs dynamic
  rendering, so the root layout reads `headers()`; every page was already session-dependent, so no
  page lost static generation. `'unsafe-eval'` is added in `next dev` only (React Refresh).
- **Styles keep `'unsafe-inline'`.** MUI/Emotion inject `<style>` tags at runtime and use inline
  `style` attributes; nonce-ing every Emotion insertion (and the `sx` inline styles) is not
  practical. Styles cannot execute script, so the residual risk is CSS-based data exfiltration,
  which `connect-src`/`img-src` limit.
- `img-src` allows `https:` for client and workspace logos hosted elsewhere.

## Secrets in client bundles

`scripts/check-bundle-secrets.sh` (CI: after `npm run build`, with dummy secret values set) greps
`.next/static` for the names `RESEND`, `ANTHROPIC`, `SERVICE_ROLE`, `DATABASE_URL`,
`REAUTH_SECRET`, `ICS_SECRET`, `CRON_SECRET` (and the full variable names) and for the dummy
values themselves. Result at review time: **PASS** (200 files). Server modules that read secrets
import `server-only`, so a client import fails the build.

## Re-verified controls

- **Session timeouts** — `lib/supabase/policy.ts` (12 h internal, 7 days clients, aal2 for
  internal) with `policy.test.ts`; unchanged and still applied in `getSession`/`getApiSession`.
- **Re-auth for approvals** — `decideGate` / `decideCriterion` refuse without a re-auth in the last
  15 minutes (demo store and the Postgres `has_fresh_reauth()` check via `record_reauth()`,
  contract-tested); F-01 closes the Supabase-mode gap in how that re-auth is obtained.
- **Audit log is append-only** — RLS test section 7 (update, delete and truncate refused even for
  the owner) and section 23 (preview trail immutable, server-stamped times).
- **Tenant isolation** — RLS suite (647 assertions incl. section 23) and the e2e matrix above.

## "View as client" preview

- Start: `/admin` → "View as client" card (org + client role) → `POST /api/session/preview`
  (Admin only, audited `preview.start`). Sets `kh_preview` (httpOnly, SameSite=Strict, 1 h),
  HMAC-signed and bound to the Admin's id.
- While previewing, `getSession()` returns the session of a representative profile of that org and
  role with `impersonation` set; pages and every API read behave exactly as for that client (RLS
  applies in Postgres mode because the subject is a real profile).
- Read-only: `middleware.ts` refuses every non-GET request (API routes, page POSTs, server actions,
  persona switch) with `403 preview_read_only`, except `DELETE /api/session/preview` and
  `POST /auth/sign-out`.
- A banner shows on every portal page with "Exit preview" (`DELETE`, audited `preview.stop` with
  the duration).
- A stale or foreign cookie is ignored by the session layer; while it exists the browser stays
  read-only until "Exit preview" or its 1-hour expiry.

## Tests

| Suite                                | What it proves                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `lib/security/routes.test.ts`        | every route × method → 401/404 without a session, no data, no cookie                  |
| `lib/security/rate-limit.test.ts`    | sliding window, Retry-After, per-key buckets, policies, pluggable backend             |
| `lib/security/request-guard.test.ts` | CSRF verdicts, preview read-only matrix, CSP shape                                    |
| `lib/security/preview.test.ts`       | preview cookie binding/tamper/expiry, subject selection                               |
| `lib/security/secrets.test.ts`       | secret fallback only in demo, cron secret constant-time and closed by default         |
| `lib/security/sanitize-html.test.ts` | XSS vectors stripped, editor HTML preserved, linear time                              |
| `supabase/tests/rls.test.sql` §23    | audit timestamps, preview trail Admin-only and immutable, zero EHR rows for Riverbend |
| `tests/e2e/security.spec.ts`         | cross-tenant matrix, headers + nonce, CSRF (API and real browser), 429s, preview      |
| `tests/e2e/a11y-themes.spec.ts`      | A11Y-01: axe on 10 internal screens in light and dark                                 |
| `scripts/check-bundle-secrets.sh`    | no server secret names or values in `.next/static` (CI)                               |
