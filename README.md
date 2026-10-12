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

| Variable                                                    | Purpose                                      |
| ----------------------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (leave empty for demo mode) |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | Server-only, for seeding and admin jobs      |
| `RESEND_API_KEY`, `EMAIL_FROM`                              | Email notifications (Phase 3)                |
| `ANTHROPIC_API_KEY`                                         | AI assist (Phase 5), server-side only        |
| `SENTRY_DSN`                                                | Error monitoring                             |

## Database, seeding and security tests

- Schema, RLS policies and rule-enforcing functions: `supabase/migrations/`
- Demo seed: `supabase/seed.sql` (`supabase db reset` applies migrations and the seed)
- Tenant-isolation suite: `npm run test:rls`
  - It spins up a throwaway local Postgres 16, or uses `DATABASE_URL`.
  - It proves a client of Org A gets zero rows from Org B on every table.
  - It proves clients never see internal rows, and that only clients can mark work Accepted.

See `docs/data-model.md` for how roles map to policies.

## Scripts

| Command                                       | What it does                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run lint` / `typecheck` / `format:check` | Static checks                                                                           |
| `npm test`                                    | Vitest unit tests (workflow rules, permissions, data layer, board ordering)             |
| `npm run test:rls`                            | Postgres RLS suite                                                                      |
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
lib/data         Repo interface + demo store (Supabase adapter lands in a later sprint)
supabase/        Migrations, seed, RLS tests
```

## Delivery

Work is tracked in Jira project **KH** (PI-1, five sprints). The board uses the DiamondEcho flow: To Do → In Progress → Pull Request → Testing → Done.
