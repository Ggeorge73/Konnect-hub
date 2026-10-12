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

| Variable                                                    | Purpose                                       |
| ----------------------------------------------------------- | --------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (leave empty for demo mode)  |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | Server-only, for seeding and admin jobs       |
| `DATABASE_URL`                                              | Server-only Postgres connection (see below)   |
| `KH_DATA`                                                   | `postgres` to use `DATABASE_URL` without Auth |
| `RESEND_API_KEY`, `EMAIL_FROM`                              | Email notifications (Phase 3)                 |
| `ANTHROPIC_API_KEY`                                         | AI assist (Phase 5), server-side only         |
| `SENTRY_DSN`                                                | Error monitoring                              |

## Data modes

`getRepo()` in `lib/data/index.ts` picks the data path:

| Mode                 | When                                                                          | Data                                    | Who is signed in                                      |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Demo                 | `DATABASE_URL` unset (default, used by e2e)                                   | In-memory seed (`lib/data/memory.ts`)   | Persona cookie (switcher in the user menu)            |
| Postgres, demo users | `DATABASE_URL` + `KH_DATA=postgres`, no Supabase vars                         | Postgres + RLS (`lib/data/postgres.ts`) | Persona cookie, mapped to the seed users' fixed uuids |
| Production           | `DATABASE_URL` + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Postgres + RLS                          | Supabase Auth (`/auth/sign-in`, `/auth/mfa`)          |

**How the Postgres repo enforces access.** Each repo call runs in one transaction that first does `set local role authenticated` and sets `request.jwt.claim.sub` / `request.jwt.claims` to the user's id. RLS policies and `auth.uid()` then behave exactly as they do behind Supabase's API, so the database is the enforcer; the app does not re-filter rows. Status changes go through `transition_work_item()`, new projects through `create_project_from_template()` and client requests through `create_client_request()`.

**`DATABASE_URL` on Supabase.** Use the **pooler** connection string (Project Settings → Database → Connection pooling, transaction mode, port 6543). The role in it must be allowed to `set role authenticated`: the default `postgres` role is, or create a dedicated login role and `grant authenticated to <role>`. Never use the service role key here and never expose this variable to the browser. The client disables prepared statements so it works with the transaction pooler.

**Auth rules (production mode).** `lib/session.ts` reads the Supabase session from cookies (`@supabase/ssr`), then loads the profile from the database as that user. Konnector staff must complete TOTP (`aal2`) or are sent to `/auth/mfa`. Sessions expire 12 hours after sign-in for staff and 7 days for clients (`lib/supabase/policy.ts`, using `auth_time`, the `amr` sign-in timestamps or `iat`). `middleware.ts` refreshes the auth cookies; it does nothing in demo mode. A signed-in user without a `profiles` row is sent back to sign-in.

## Database, seeding and security tests

- Schema, RLS policies and rule-enforcing functions: `supabase/migrations/`
- Demo seed: `supabase/seed.sql` (`supabase db reset` applies migrations and the seed)
- Tenant-isolation suite: `npm run test:rls`
  - It spins up a throwaway local Postgres 16, or uses `DATABASE_URL`.
  - It proves a client of Org A gets zero rows from Org B on every table.
  - It proves clients never see internal rows, and that only clients can mark work Accepted.
- Repo contract suite: `bash supabase/tests/run-contract-tests.sh`
  - `lib/data/contract.ts` holds the scenarios every `Repo` must pass (tenant isolation, internal items and comments, budgets, associate scope, templates, item keys, acceptance, comments, client requests, search).
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
