# Konnect ART — engineering brief for feature teams

Read `CLAUDE.md` (the product spec) and this brief, then the code. Match existing style exactly.

## Architecture (must follow)

- Next.js 15 App Router + TS strict + MUI v6 (use `@mui/material/Grid2` for grids) + TanStack Query + dnd-kit + zod + Tiptap.
- **All data access goes through `lib/data`.** Demo mode uses the in-memory store in `lib/data/memory.ts` (`db()` returns the global Db built by `buildSeed()` in `lib/data/seed.ts`).
- **Permissions mirror RLS.** Use helpers in `lib/domain/permissions.ts`. Client users (client_sponsor/member/viewer) must never receive internal-visibility rows, budgets or cost rates. Every new list/get must filter by `canSeeProject` + `canSeeVisibility`. Throw `ForbiddenError` / `NotFoundError` / `ValidationError` from `lib/data/errors.ts`.
- Route handlers use `handle()` from `lib/api.ts` and zod schemas.
- Client hooks live next to the feature (or in `lib/client/api.ts` style) using `api()` from `lib/client/api.ts`.
- Project pages render inside `features/projects/ProjectFrame.tsx` (use `useProjectBundle()`); the item side panel opens with `?item=KEY`.
- Design: "Konnector Glass" — glass Paper cards (`borderRadius: 4` = 16px), RAG always colour + icon + text, monospace (`Mono`, `ItemKey`) for keys and numbers, empty states via `EmptyState` with one clear action, keyboard accessible, WCAG AA contrast.
- SQL: `supabase/migrations/0001_core.sql` already has tables for phases, gate_criteria, gate_reviews, deliverables, deliverable_items, acceptance_criteria, sprints, raid_entries, etc. with RLS. If you need schema changes, add a NEW migration file `supabase/migrations/00NN_<name>.sql` and extend `supabase/tests/rls.test.sql`; `npm run test:rls` must still pass.

## To avoid merge conflicts with the other teams working in parallel

- Put your domain code in NEW files: `lib/domain/<domain>.ts` (types + pure rules), `lib/data/<domain>.ts` (repo functions taking `(s: Session, ...)` and using `db()`), `app/api/<domain>/...`, `features/<domain>/...`, tests `lib/**/<domain>.test.ts`.
- Extend `Db` by adding optional arrays in your own file is NOT possible, so: add your new arrays to the `Db` interface and `buildSeed()` in `lib/data/seed.ts` with the smallest possible edit (one line in the interface, one line in the return object calling a `seed<Domain>()` function you define in your own file `lib/data/seed-<domain>.ts`).
- Shared files you may touch minimally: `lib/data/seed.ts` (as above), `features/projects/ProjectFrame.tsx` (TABS array only), `components/shell/AppShell.tsx` (nav only, only if needed), `lib/domain/types.ts` (append only).

## Definition of done (all must pass before you finish)

`npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:rls && npm run build && npm run test:e2e`
Add unit tests for every rule, and add at least one Playwright test in `tests/e2e/<domain>.spec.ts` for your main flow (use `page.request.post('/api/session', { data: { userId } })` to switch persona; personas: u_admin, u_lead, u_team, u_dev, u_assoc (non-US), u_sponsor/u_cmember/u_cviewer (Peachtree client), u_rsponsor (Riverbend client)). Playwright browsers are preinstalled; never run `playwright install`. E2E tests share one server process and in-memory state, so make your tests independent of other spec files (use your own items/projects or create fresh ones).
Commit your work in your worktree with a conventional commit message ending with:

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HJkeevHN8yW1mhDoRzxxp5

Do NOT push. Do NOT touch Jira or GitHub. Report: commit sha, branch name, worktree path, files changed summary, test results, and any shared-file edits.
