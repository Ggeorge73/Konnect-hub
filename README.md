# Konnect Hub

Konnector LLC's project delivery platform: a board-based work tracker like Jira or Azure DevOps, rebuilt around the **Konnect Delivery Framework**. That framework has five gated phases (Mobilize → Plan → Execute → Accept → Transition), Agile sprints inside them, and a client sign-off at every gate.

> "Konnect Hub" is a working title. The name lives in one place: `APP_NAME` in `lib/config.ts`.

More documentation:

- [`docs/architecture.md`](docs/architecture.md): stores, RLS and the request flow, with a diagram
- [`docs/data-model.md`](docs/data-model.md): tables, roles and the rules enforced in the database
- [`docs/runbook.md`](docs/runbook.md): deploy, backups and restore, secrets, cron jobs, incidents
- [`docs/user-guide.md`](docs/user-guide.md): one page per role
- [`docs/TEAM_BRIEF.md`](docs/TEAM_BRIEF.md): engineering conventions for feature teams

## Quick start (demo mode, no accounts needed)

Requirements: Node 22 and npm. Postgres 16 is only needed for the database test suites.

```bash
npm install
npm run dev        # http://localhost:3000
```

With no database or Supabase variables set, the app runs on a seeded in-memory store. The store includes the **"Demo — Clinic EHR Go-Live"** project, a second client and a support retainer. Click your name at the bottom of the sidebar to switch between personas: Admin, Delivery Lead, Team Member, Associate, Client Sponsor, Client Member and Client Viewer. Client users land in the `/portal` view and never see internal items, comments, files or budgets.

## Three ways to run

`getRepo()` in `lib/data/index.ts` picks the data path, and every domain store (`raidStore()`, `adminStore()`, `attachmentStore()` and the rest) follows the same switch.

| Mode                     | Set these                                                                     | Data                                    | Who is signed in                                | Files                      | Email               |
| ------------------------ | ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | -------------------------- | ------------------- |
| **Demo** (default, e2e)  | nothing                                                                       | In-memory seed (`lib/data/memory.ts`)   | Persona cookie (switcher in the user menu)      | In memory                  | Dev outbox          |
| **Postgres, demo users** | `DATABASE_URL` + `KH_DATA=postgres`                                           | Postgres + RLS (`lib/data/postgres.ts`) | Persona cookie, mapped to the seed users' uuids | OS temp dir                | Dev outbox          |
| **Supabase**             | `DATABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Postgres + RLS                          | Supabase Auth (`/auth/sign-in`, `/auth/mfa`)    | Supabase Storage (private) | Resend (if key set) |

The **dev outbox** is in memory: with `RESEND_API_KEY` unset, every email (notifications, digests, invites) is kept there and readable at `GET /api/dev/outbox?to=<email>` (404 once Supabase is configured).

### Local Postgres

```bash
createdb konnect
for f in supabase/tests/auth-stub.sql supabase/migrations/*.sql supabase/seed.sql; do psql konnect -v ON_ERROR_STOP=1 -f "$f"; done
DATABASE_URL=postgresql://localhost/konnect KH_DATA=postgres npm run dev
```

`supabase/tests/auth-stub.sql` stands in for Supabase's `auth` schema (`auth.users`, `auth.uid()` and the `authenticated` / `service_role` roles). On a real Supabase project, skip it: `supabase db reset` applies the migrations and `supabase/seed.sql`.

### Supabase

1. Create a project (one for dev, one for production). Apply the migrations with `supabase db push` (or `supabase db reset` on dev, which also loads the demo seed).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` (see below).
3. Enable TOTP MFA (Authentication → Sign In / Providers → Multi-Factor). Konnector staff must complete TOTP (`aal2`).
4. Turn off public sign-ups. People join through **Admin → Invites**, which calls `auth.admin.inviteUserByEmail` with the service role (server-only) and creates their `profiles` row with the chosen role and organization.
5. Files go to private Storage buckets, one per client organization (`kh-org-<org id>`, created on first upload), plus `kh-branding` for logos. Downloads are 5-minute signed URLs issued by `/api/attachments/:id/download` after the permission check.

**`DATABASE_URL` on Supabase.** Use the **pooler** connection string (Project Settings → Database → Connection pooling, transaction mode, port 6543). The role in it must be allowed to `set role authenticated`: the default `postgres` role is, or create a dedicated login role and `grant authenticated to <role>`. Never use the service role key here and never expose this variable to the browser. The client disables prepared statements so it works with the transaction pooler.

**How the Postgres repo enforces access.** Each repo call runs in one transaction that first does `set local role authenticated` and sets `request.jwt.claim.sub` / `request.jwt.claims` to the user's id. RLS policies and `auth.uid()` then behave exactly as they do behind Supabase's API, so the database is the enforcer; the app does not re-filter rows. Status changes go through `transition_work_item()`, new projects through `create_project_from_template()` and client requests through `create_client_request()`. Postgres writes dispatch notifications in the same transaction through `pgNotify` (`lib/data/notify-postgres.ts`); emails and real-time events go out after commit. In production, Supabase Realtime replaces the in-process real-time bus (`lib/realtime/bus.ts`).

**Auth rules (Supabase mode).** `lib/session.ts` reads the Supabase session from cookies (`@supabase/ssr`), then loads the profile from the database as that user. Konnector staff must complete TOTP (`aal2`) or are sent to `/auth/mfa`. Sessions expire 12 hours after sign-in for staff and 7 days for clients (`lib/supabase/policy.ts`). `middleware.ts` refreshes the auth cookies; it does nothing in demo mode. A signed-in user without a `profiles` row, or whose profile an Admin deactivated, is sent back to sign-in; a deactivated user is also banned in Supabase Auth and has no role under RLS.

**Google and Microsoft sign-in (KH-41).** `/auth/sign-in` shows "Continue with Google" and "Continue with Microsoft" when Supabase is configured (never in demo mode). They call `supabase.auth.signInWithOAuth` with the providers `google` and `azure`, scopes `openid email profile`, and come back to `/auth/callback`. Accounts are invitation-only: the callback lets a user in only when an invited `profiles` row matches the signed-in identity (`lib/auth/oauth.ts`); anyone else is signed out and sent to `/auth/invite`. An OAuth session is `aal1`, so Konnector staff still complete TOTP.

Setup in the Supabase dashboard:

1. **Authentication → Sign In / Providers → Google**: enable it and paste the OAuth client ID and secret from Google Cloud Console (APIs & Services → Credentials → OAuth client ID, type "Web application"). In Google, add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Authentication → Sign In / Providers → Azure (Microsoft)**: enable it with the Application (client) ID and a client secret from Microsoft Entra ID (App registrations → New registration, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, platform "Web"). Set the **Azure Tenant URL** to `https://login.microsoftonline.com/<tenant-id>` to allow only your organization. Add the optional `email` claim to the ID token so Supabase receives a verified email.
3. **Authentication → Sign In / Providers → User Signups**: turn off **Allow new users to sign up**.
4. **Authentication → URL Configuration**: set **Site URL** to the app's URL and add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local development) to **Redirect URLs**.
5. Optional: set `AUTH_OAUTH_PROVIDERS=google` (or `azure`, or `none`) to show only some buttons.

## Environment variables

Copy `.env.example` to `.env.local`. Everything is optional in demo mode.

| Variable                                                  | Where            | Purpose                                                                                                                                                        |
| --------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                | browser + server | Supabase project URL. Empty = demo mode.                                                                                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                           | browser + server | Supabase anon key (RLS applies).                                                                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                               | server only      | Admin invites (`inviteUserByEmail`), user bans on deactivation, Storage uploads and signed URLs. Bypasses RLS: used only after the app's own permission check. |
| `DATABASE_URL`                                            | server only      | Postgres connection (pooler, transaction mode, on Supabase).                                                                                                   |
| `KH_DATA`                                                 | server only      | `postgres` to use `DATABASE_URL` without Supabase Auth (demo personas).                                                                                        |
| `AUTH_OAUTH_PROVIDERS`                                    | server only      | Social sign-in buttons: `google`, `azure`, `google,azure` or `none` (default: both).                                                                           |
| `REAUTH_SECRET`                                           | server only      | HMAC key for the fresh re-auth cookie on gate and acceptance approvals. Long random value in production.                                                       |
| `RESEND_API_KEY`                                          | server only      | Sends email through Resend. Unset = dev outbox.                                                                                                                |
| `EMAIL_FROM`                                              | server only      | Sender, e.g. `Konnect Hub <hub@konnectortech.com>` (a verified Resend domain).                                                                                 |
| `APP_URL`                                                 | server only      | Absolute base URL for links in emails, invites and calendar feeds.                                                                                             |
| `ICS_SECRET`                                              | server only      | HMAC key for personal calendar feed tokens. Rotating it revokes every feed URL.                                                                                |
| `CRON_SECRET`                                             | server only      | Shared secret the scheduled jobs send as `x-cron-secret` (digest, RAID escalation).                                                                            |
| `ANTHROPIC_API_KEY`                                       | server only      | AI assist (Phase 5).                                                                                                                                           |
| `ANTHROPIC_MODEL`, `KH_AI_PROVIDER`, `KH_AI_RATE_PER_MIN` | server only      | AI model (default `claude-opus-5-5`); `fake` or `off` to force a provider; per-user AI requests per minute (default 10).                                       |
| `SENTRY_DSN`                                              | server only      | Error monitoring.                                                                                                                                              |
| `TEST_DATABASE_URL`                                       | tests            | Set by `run-contract-tests.sh`; runs the Postgres contract suites.                                                                                             |
| `KH_PG_PORT`, `PG_BIN`                                    | tests            | Port (default 54329) and binaries (default `/usr/lib/postgresql/16/bin`) of the throwaway test cluster.                                                        |
| `PORT`, `CI`                                              | tests            | Playwright server port (default 3100); `CI=1` makes Playwright start its own server and retry once.                                                            |

## Seeding

- **Demo store:** `buildSeed()` in `lib/data/seed.ts` builds the in-memory database on first use; each domain adds its slice from `lib/data/seed-<domain>.ts` (e.g. `seed-admin.ts` for custom fields, workflows and attachments). Restarting the server resets it.
- **Postgres / Supabase:** `supabase/seed.sql` mirrors the demo store with fixed uuids (`lib/data/seed-ids.ts` maps persona ids to them). `supabase db reset` loads it on Supabase; locally run it after the migrations (see above). Never load it into production.
- **Demo project:** Admins delete "Demo — Clinic EHR Go-Live" from **Admin → Demo project** (soft delete, audited).

## Adding a project template

Admins can do it without code: **Admin → Project templates → Create from this** copies any template, then edits each gate's exit criteria and the RAID categories. The template is stored in the `templates` table (0017) and appears in the create-project dialog straight away; archiving hides it there, and existing projects keep it.

To ship a new **built-in** template:

1. Add it to `TEMPLATES` in `lib/domain/templates.ts`: an id, a name, the five phases with their exit criteria (gate names are fixed) and the RAID categories.
2. Add a migration (`supabase/migrations/00NN_<name>.sql`) that inserts the same template into `public.templates` with `builtin = true`. `create_project_from_template()` reads gates and criteria from that table, so both data paths seed the same gates.
3. Run `npm test` and the contract suite; the admin contract checks the built-in list.

## Tests

| Command                                       | What it runs                                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` / `typecheck` / `format:check` | ESLint, `tsc --noEmit`, Prettier                                                                                                                                                                                                                                 |
| `npm test`                                    | Vitest: domain rules, permissions, EVM, workflow, and every store's contract suite against the demo store                                                                                                                                                        |
| `npm run test:rls`                            | `supabase/tests/run-rls-tests.sh`: throwaway Postgres 16 (or `DATABASE_URL` as superuser) + migrations + seed + `rls.test.sql`. Proves a client of Org A gets zero rows from Org B on every table, clients never see internal rows, and the database rules hold. |
| `bash supabase/tests/run-contract-tests.sh`   | The same contract suites against the Postgres stores (`postgres.test.ts`, `capacity-postgres.test.ts`, `admin-postgres.test.ts`); each scenario gets a fresh clone of the seeded database. Pass extra test files as arguments.                                   |
| `npm run build && npm run test:e2e`           | Playwright (`tests/e2e/*.spec.ts`) against `next start`, including axe accessibility scans in both themes                                                                                                                                                        |

When several checkouts run in parallel, give each its own ports: `KH_PG_PORT=54704 npm run test:rls`, `KH_PG_PORT=54714 bash supabase/tests/run-contract-tests.sh`, `PORT=3504 CI=1 npm run test:e2e`.

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

## Layout

```
app/(internal)   Konnector staff routes (portfolio, projects, board, list, admin console…)
app/portal       Client portal (scoped, light theme)
app/api          Route handlers; all data access goes through lib/data
components/      Shell, gate tracker, shared UI
features/        One folder per domain: boards, list, items, admin, files, gates, raid, portal…
lib/domain       Types and pure rules (permissions, workflow, admin, files…), unit-tested
lib/data         Stores: demo (memory) + Postgres + RLS for each domain, and their contract suites
lib/files        Attachment storage backends, the virus-scan hook and upload/download helpers
lib/supabase     Supabase Auth clients, session policy and the server-only admin client
app/auth         Sign-in (password, magic link, Google, Microsoft), MFA, callback, sign-out
supabase/        Migrations, seed, RLS and contract test scripts
docs/            Architecture, data model, runbook, user guide
```

## Delivery

Work is tracked in Jira project **KH** (PI-1, five sprints). The board uses the DiamondEcho flow: To Do → In Progress → Pull Request → Testing → Done.
