# Konnect Hub

Konnector LLC's project delivery platform: a board-based work tracker like Jira or Azure DevOps, rebuilt around the **Konnect Delivery Framework**. That framework has five gated phases (Mobilize → Plan → Execute → Accept → Transition), Agile sprints inside them, and a client sign-off at every gate.

> "Konnect Hub" is a working title. The name lives in one place: `APP_NAME` in `lib/config.ts`.

## Quick start (demo mode, no accounts needed)

```bash
npm install
npm run dev        # http://localhost:3000
```

With no Supabase variables set, the app runs on a seeded in-memory store. The store includes the **"Demo — Clinic EHR Go-Live"** project, a second client and a support retainer. Click your name at the bottom of the sidebar to switch between personas: Admin, Delivery Lead, Team Member, Associate, Client Sponsor, Client Member and Client Viewer. Client users land in the `/portal` view and never see internal items, comments or budgets.

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable                                                    | Purpose                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (leave empty for demo mode)                         |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | Server-only, for seeding and admin jobs                              |
| `DATABASE_URL`                                              | Server-only Postgres connection (see below)                          |
| `KH_DATA`                                                   | `postgres` to use `DATABASE_URL` without Auth                        |
| `AUTH_OAUTH_PROVIDERS`                                      | Social sign-in buttons: `google`, `azure`, or `none` (default: both) |
| `RESEND_API_KEY`, `EMAIL_FROM`                              | Email notifications (Phase 3)                                        |
| `ANTHROPIC_API_KEY`                                         | AI assist (Phase 5), server-side only                                |
| `ANTHROPIC_MODEL`, `KH_AI_PROVIDER`, `KH_AI_RATE_PER_MIN`   | AI model (default `claude-opus-5-5`), `fake`/`off`, rate per minute  |
| `SENTRY_DSN`                                                | Error monitoring                                                     |

## Data modes

`getRepo()` in `lib/data/index.ts` picks the data path:

| Mode                 | When                                                                          | Data                                    | Who is signed in                                      |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Demo                 | `DATABASE_URL` unset (default, used by e2e)                                   | In-memory seed (`lib/data/memory.ts`)   | Persona cookie (switcher in the user menu)            |
| Postgres, demo users | `DATABASE_URL` + `KH_DATA=postgres`, no Supabase vars                         | Postgres + RLS (`lib/data/postgres.ts`) | Persona cookie, mapped to the seed users' fixed uuids |
| Production           | `DATABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Postgres + RLS                          | Supabase Auth (`/auth/sign-in`, `/auth/mfa`)          |

**Domain stores.** Every domain (RAID, sprints, gates, deliverables, acceptance records, the executive dashboard and EVM, agile metrics, status reports, and notifications/watchers/preferences) has a demo and a Postgres implementation behind the same public functions, switched exactly like `getRepo()`. Postgres writes (items, comments, gates, deliverables, RAID) dispatch notifications in the same transaction through `pgNotify` (`lib/data/notify-postgres.ts`), which applies the demo store's client-safety rule; emails and real-time events go out after commit. In production, Supabase Realtime replaces the in-process real-time bus (`lib/realtime/bus.ts`); the SSE endpoint keeps working for a single server process.

**How the Postgres repo enforces access.** Each repo call runs in one transaction that first does `set local role authenticated` and sets `request.jwt.claim.sub` / `request.jwt.claims` to the user's id. RLS policies and `auth.uid()` then behave exactly as they do behind Supabase's API, so the database is the enforcer; the app does not re-filter rows. Status changes go through `transition_work_item()`, new projects through `create_project_from_template()` and client requests through `create_client_request()`.

**`DATABASE_URL` on Supabase.** Use the **pooler** connection string (Project Settings → Database → Connection pooling, transaction mode, port 6543). The role in it must be allowed to `set role authenticated`: the default `postgres` role is, or create a dedicated login role and `grant authenticated to <role>`. Never use the service role key here and never expose this variable to the browser. The client disables prepared statements so it works with the transaction pooler.

**Auth rules (production mode).** `lib/session.ts` reads the Supabase session from cookies (`@supabase/ssr`), then loads the profile from the database as that user. Konnector staff must complete TOTP (`aal2`) or are sent to `/auth/mfa`. Sessions expire 12 hours after sign-in for staff and 7 days for clients (`lib/supabase/policy.ts`, using `auth_time`, the `amr` sign-in timestamps or `iat`). `middleware.ts` refreshes the auth cookies; it does nothing in demo mode. A signed-in user without a `profiles` row is sent back to sign-in.

**Google and Microsoft sign-in (KH-41).** `/auth/sign-in` shows "Continue with Google" and "Continue with Microsoft" when Supabase is configured (never in demo mode). They call `supabase.auth.signInWithOAuth` with the providers `google` and `azure`, scopes `openid email profile`, and come back to `/auth/callback`. Accounts are invitation-only: the callback lets a user in only when an invited `profiles` row matches the signed-in identity (same id and email, `lib/auth/oauth.ts`); anyone else is signed out and sent to `/auth/invite` ("Ask your Konnector admin for an invite"). Nothing creates a profile from a social sign-in. An OAuth session is `aal1`, so Konnector staff still complete TOTP at `/auth/mfa` (the same `aal2` rule).

Setup in the Supabase dashboard:

1. **Authentication → Sign In / Providers → Google**: enable it and paste the OAuth client ID and secret from Google Cloud Console (APIs & Services → Credentials → OAuth client ID, type "Web application"). In Google, add the authorized redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Authentication → Sign In / Providers → Azure (Microsoft)**: enable it with the Application (client) ID and a client secret from Microsoft Entra ID (App registrations → New registration, redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`, platform "Web"). Set the **Azure Tenant URL** to `https://login.microsoftonline.com/<tenant-id>` to allow only your organization, or leave the default for any work or personal account. Add the optional `email` claim to the ID token (Token configuration) so Supabase receives a verified email.
3. **Authentication → Sign In / Providers → User Signups**: turn off **Allow new users to sign up**, so an unknown email is refused before any auth user exists (the callback sends it to `/auth/invite`). Invite users from **Authentication → Users → Invite user**, then create their `profiles` row; Supabase links a Google or Microsoft identity to the invited user when the provider reports the same verified email.
4. **Authentication → URL Configuration**: set **Site URL** to the app's URL and add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local development) to **Redirect URLs**.
5. Optional: set `AUTH_OAUTH_PROVIDERS=google` (or `azure`, or `none`) to show only some buttons.

## Database, seeding and security tests

- Schema, RLS policies and rule-enforcing functions: `supabase/migrations/`
- Demo seed: `supabase/seed.sql` (`supabase db reset` applies migrations and the seed)
- Tenant-isolation suite: `npm run test:rls`
  - It spins up a throwaway local Postgres 16, or uses `DATABASE_URL`.
  - It proves a client of Org A gets zero rows from Org B on every table.
  - It proves clients never see internal rows, and that only clients can mark work Accepted.
- Repo contract suite: `bash supabase/tests/run-contract-tests.sh`
  - `lib/data/contract.ts` holds the scenarios every `Repo` must pass (tenant isolation, internal items and comments, budgets, associate scope, templates, item keys, acceptance, comments, client requests, search).
  - `lib/data/contract-domains.ts` adds the domain suites (RAID, sprints, gates, deliverables, insight, pulse, signal).
  - `npm test` runs them against the in-memory store. The script loads a throwaway Postgres (same rules as `test:rls`) and runs them against the Postgres repo with `TEST_DATABASE_URL`; each scenario gets a fresh copy of the seeded database.

See `docs/data-model.md` for how roles map to policies.

## Scripts

| Command                                       | What it does                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run lint` / `typecheck` / `format:check` | Static checks                                                                           |
| `npm test`                                    | Vitest unit tests (workflow rules, permissions, data layer, board ordering)             |
| `npm run test:rls`                            | Postgres RLS suite                                                                      |
| `bash supabase/tests/run-contract-tests.sh`   | Repo contract suite against Postgres + RLS                                              |
| `npm run build && npm run test:e2e`           | Playwright smoke (create project → move card → client accepts) + axe accessibility scan |

CI runs all of these on every pull request (`.github/workflows/ci.yml`).

## Adding a project template

Add an entry to `TEMPLATES` in `lib/domain/templates.ts`: phases, their exit criteria and RAID categories. Mirror it in `create_project_from_template` in the SQL migration so both data paths seed the same gates.

## Layout

```
app/(internal)   Konnector staff routes (portfolio, projects, board, list, search…)
app/portal       Client portal (scoped, light theme)
app/api          Route handlers; all access goes through lib/data Repo
components/      Shell, gate tracker, shared UI
features/        One folder per domain: boards, list, items, portfolio, projects, portal, search
lib/domain       Types, workflow rules, permissions, templates (pure, unit-tested)
lib/data         Repo interface, demo store, Postgres + RLS repo, shared contract tests
lib/supabase     Supabase Auth clients (server, browser, middleware) and the session policy
app/auth         Sign-in (password + magic link), MFA (TOTP), callback and sign-out
supabase/        Migrations, seed, RLS tests
```

## Delivery

Work is tracked in Jira project **KH** (PI-1, five sprints). The board uses the DiamondEcho flow: To Do → In Progress → Pull Request → Testing → Done.
