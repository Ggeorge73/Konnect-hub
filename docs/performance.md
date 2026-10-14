# Performance at 2× scale (KH-46 [PERF-01])

CLAUDE.md §1 sizes Konnect Hub for 60 active projects, 10,000 items per project and 200,000 items in
total, and asks us to test at 2×. §4 sets the targets. This page records how we measured them, what we
found, what we changed and how to run the checks again.

## Targets and results

| Target (CLAUDE.md §4)                        | Measured on                                  | Before                                          | After                                        | Budget   |
| -------------------------------------------- | -------------------------------------------- | ----------------------------------------------- | -------------------------------------------- | -------- |
| Portfolio, 60+ projects, time to interactive | 120 projects, memory store, Chromium         | 692 ms                                          | **460–760 ms** (median of 5)                 | 1,500 ms |
| Board, 500 visible cards, initial render     | project LOAD, 20,000 items                   | **never rendered** (> 60 s, 12.0 MB, 20k cards) | **620–840 ms**, 546 KB, 700 cards, 84 in DOM | 2,000 ms |
| Board drag, 60 fps                           | pointer drag across columns, rAF frame times | not measurable                                  | median **16.7 ms**, p95 33–50 ms             | 20 / 67  |
| Item side panel opens (hover prefetch)       | LOAD board, click event → title shown        | 311 ms (470 ms incl. Playwright overhead)       | **76–122 ms** (median of 7)                  | 300 ms   |
| Search, 200k+ items (Postgres, RLS on)       | 400,029 items, 99,967 comments, 123 projects | 183–290 ms items, **14.2 s** client comments    | **3–280 ms** items, **58–160 ms** comments   | 500 ms   |
| Search, memory store                         | 20k-item project, `/api/search`              | 20–111 ms                                       | 28–50 ms                                     | 500 ms   |
| Real-time update                             | covered by `tests/e2e/signal.spec.ts`        | < 3 s (e2e asserts)                             | unchanged                                    | 2 s      |

Numbers are from a shared, busy development container (load average 4–8 from other builds), so they
vary between runs; ranges are the spread we saw over several runs. The perf suite asserts the budgets on
medians, never on a single sample.

## Method

### Data: a deterministic 2×-scale dataset

- **`scripts/seed-load.ts`** generates the dataset with a seeded PRNG (byte-identical output for the
  same options): 120 projects (2 × 60) over both demo clients, one project `LOAD` with **20,000** items
  (2 × 10,000), items in every other project, about one comment per four items (40% internal) and RAID
  entries per project. Status, type and priority follow fixed weights (40% Backlog, 15% Ready, …).
  - Memory store: `KH_LOAD=1` makes `lib/data/memory.ts` append it to the demo seed. Defaults: 120
    projects, 20,000 items in LOAD, 40 items in each other project (≈ 24,760 items, so CI-sized runs stay
    fast). Override with `KH_LOAD_ITEMS`, `KH_LOAD_OTHER_ITEMS`, `KH_LOAD_PROJECTS`.
  - `node --experimental-strip-types scripts/seed-load.ts [projects] [bigItems] [otherItems]` prints a
    summary of what would be generated.
- **`supabase/tests/load.sql`** builds the same shape in Postgres with `generate_series` in one
  transaction (no client round trips): by default **400,000** items (2 × 200,000) across 120 projects,
  20,000 of them in LOAD, plus 100,000 comments and 3,600 RAID entries. It loads in about 35 s.
  Parameters: `psql -v projects=… -v big_items=… -v items_total=…`.

### Browser measurements (memory store)

`tests/perf/scale.spec.ts` runs only with `KH_PERF=1`, from its own config
(`playwright.perf.config.ts`, `testDir: tests/perf`), so `npm run test:e2e` never runs it. The config
starts `next start` with `KH_LOAD=1`. Each test warms the route first, then samples:

- **Portfolio:** `performance.now()` at the first animation frame where 60+ project links are on screen
  (the page renders client-side after hydration and `/api/projects`, so this is time to interactive),
  then a click on the table view to prove it responds. Median of 5.
- **Board:** `performance.now()` at the first frame with a LOAD card, the loaded card count
  (`data-loaded` per column), the number of card DOM nodes, and the payload of the board API versus the
  whole-project item list. Median of 5.
- **Drag:** a 40-step pointer drag from Backlog to Ready while a `requestAnimationFrame` loop records frame
  intervals (the drop itself is excluded). Median and p95.
- **Lazy loading:** scroll the Backlog column to its end and wait for its loaded count to grow.
- **Item panel:** hover a card (prefetch), wait for the network to settle, then time from the browser's
  `click` event (a capturing listener, so Playwright's own actionability checks are excluded) to the
  panel's title input showing the item. Median of 7.
- **Search:** wall time of `/api/search` for six queries (common words, phrases, a key, no match).

`KH_PERF_RECORD=1` records without asserting (used for the "before" numbers).

### Postgres measurements

`supabase/tests/run-load-tests.sh` creates a throwaway database (migrations + seed + `load.sql`), then
runs `supabase/tests/load-check.sql`. That script runs **the app's exact queries** as a Delivery Lead
and as a Client Sponsor with **RLS on** (`set role authenticated` + JWT claims), prints
`EXPLAIN (ANALYZE)` for each, and fails if

- the candidate lookups do not use `work_items_search_idx` (GIN), `work_items_key_lower_idx` and
  `comments_body_search_idx`,
- the board column query does not read `work_items` through an index,
- any search or the board page takes longer than 500 ms (best of 3, after a warm-up run).

It also runs the Sprint 4 ("before") queries for comparison.

## Findings and fixes

### 1. The board downloaded and rendered the whole project

The board fetched `GET /api/items?projectId=…` (every item, 12.0 MB for LOAD) and rendered every card:
20,000 cards never finished rendering. Fixes:

- **Server-side paging:** `GET /api/projects/:key/board` returns the first 100 cards of each status
  column by board position, per-column totals (for counts and WIP limits) and the project's epics and
  features (for swimlanes by epic), with the filters applied on the server (types, assignee, active
  sprint, card filter). `limits=backlog:200,…` asks for more of one column. Pure rules in
  `lib/domain/board-page.ts`; stores in `lib/data/board.ts` (demo, via `listItems` so visibility is
  identical) and `lib/data/board-postgres.ts` (one `order by position limit n` per column via a LATERAL
  join, under RLS). Both stores pass the same contract (`lib/data/contract-board.ts`).
- **Lazy loading:** a column asks for 100 more cards when its last loaded cards scroll into view, or with
  its "Load more (100 of 8,012)" button.
- **Virtualised columns:** columns with more than 60 cards render only the cards in view
  (`@tanstack/react-virtual`, absolutely positioned rows with measured heights). The card being dragged is
  always kept mounted (`rangeExtractor`), so dnd-kit pointer and keyboard moves keep working; short
  columns render exactly as before (the keyboard-move e2e test is unchanged and passes).
- **Fewer re-renders while dragging:** columns are memoised with stable props, and only the column
  holding the dragged card receives the active id, so picking up a card no longer re-renders every
  column's card list.
- Optimistic updates (`useUpdateItem`) now patch every cached item list under `qk.items(projectId)`,
  including board pages, so card moves stay instant.

Result: 546 KB instead of 12.0 MB, 84 card nodes in the DOM instead of 20,000, and a first render in
well under the 2 s budget.

### 2. The item panel waited for a server round trip

Opening a card called `router.replace('?item=KEY')`, which made Next.js fetch the dynamic route's RSC
payload before the panel could render (≈ 200 ms). The board, list and panel now update the query string
with `window.history.replaceState` (`lib/client/url.ts`), which Next.js keeps in sync with
`useSearchParams()` without a request. The panel also paints its header, title and fields first and
mounts the heavier sections (rich-text editor, criteria, RAID, time, comments) two frames later in a
transition. Deep links (`?item=KEY`) work as before.

### 3. Under RLS, Postgres search could not use its indexes

`work_items_search_idx` (GIN) existed, but as `authenticated` the planner never used it: RLS policies must
be applied before any user condition whose functions are not `LEAKPROOF`, and `tsvector @@ tsquery` and
`lower()` are not. Every search was a sequential scan of all 400k items (as the table owner, which
bypasses RLS, the same query used the index, so it looked fine when tried by hand). Comment search was
worse: no index at all, and for client users the comments policy calls `entity_visible()` per row,
so a client's comment search took **14.2 s**. Marking built-ins `LEAKPROOF` needs a superuser, which a
managed Supabase project does not have.

Migration `0015_flow_search_indexes.sql`:

- `search_work_item_ids(q, limit, types, statuses, visibility)` and `search_comment_ids(q, limit)`:
  `SECURITY DEFINER` candidate functions that do the indexed lookup and apply **the same rules as the
  select policies** (visible project, internal or shared, not deleted). They return ids and ranks only.
  `lib/data/postgres.ts` then reads the rows through the normal, RLS-protected tables, so RLS still has
  the final say on every result: a mistake in a function can only drop rows, never leak them. Execute is
  revoked from `anon`. RLS test block 22 proves no cross-client rows, no internal rows for clients, no
  deleted items, and no access for `anon`.
- `work_items_key_lower_idx` on `lower(key)` so "search by key" combines with the GIN index in a
  `BitmapOr`.
- `comments_body_search_idx`, a GIN expression index on `to_tsvector('english', body)`.
- The visible project ids are read once as an array: inside a generically-planned SQL function,
  `in (select visible_project_ids())` became a nested loop re-running the function per candidate
  (2.7 s for 8k matches) until we changed it to `= any (array(select …))`.
- `rows 50` / `rows 20` estimates so the caller fetches the returned ids by primary key.

`EXPLAIN ANALYZE` at 400,029 items, Client Sponsor, search for `LOAD-19999`:

```text
BEFORE (Sprint 4 query, RLS on): 244 ms
  ->  Seq Scan on work_items w (actual rows=0 loops=1)
        Filter: ((deleted_at IS NULL) AND (hashed SubPlan 1) AND (...) AND
                 ((search_vector @@ '''load'' <-> ''-19999'''::tsquery) OR (lower(key) = ...)))
        Rows Removed by Filter: 400029

AFTER (candidates inside search_work_item_ids): 13 ms
  ->  Bitmap Heap Scan on work_items w (actual rows=0 loops=1)
        Recheck Cond: (((search_vector @@ '''load'' <-> ''-19999'''::tsquery) OR
                        (lower(key) = 'load-19999'::text)) AND (project_id = ANY ($0)) AND (deleted_at IS NULL))
        ->  BitmapAnd
              ->  BitmapOr
                    ->  Bitmap Index Scan on work_items_search_idx
                    ->  Bitmap Index Scan on work_items_key_lower_idx
              ->  Bitmap Index Scan on work_items_backlog_idx
```

Full results at 400k (best of 3, warm cache, RLS on):

| Query                                 | Lead before | Lead after | Sponsor before | Sponsor after |
| ------------------------------------- | ----------- | ---------- | -------------- | ------------- |
| Items: `19999` (selective)            | 210 ms      | 3 ms       | 184 ms         | 13 ms         |
| Items: `LOAD-19999` (key)             | 233 ms      | 29 ms      | 195 ms         | 14 ms         |
| Items: `pharmacy sync` (33k matches)  | 266 ms      | 264 ms     | 198 ms         | 95 ms         |
| Items: `reconcile` (50k matches, 12%) | 251 ms      | 281 ms     | 189 ms         | 92 ms         |
| Comments: `credentials` (17k matches) | 724 ms      | 160 ms     | **14,248 ms**  | 58 ms         |
| Board page, 7 columns × 100 (LOAD)    | —           | 4 ms       | —              | 6 ms          |

Very common words still rank every match (`ts_rank` over 33–50k rows), which is why they stay near
250 ms for internal users: inside the budget, and real titles are far less repetitive than the
generated ones. If that ever matters, cap ranking to the first N candidates.

### 4. Smaller things

- The demo store's `listProjects` filtered every item once per project (quadratic at 120 projects ×
  25k items); it now groups items by project once. `createItem` no longer spreads every position into
  `Math.max`.
- The board card filter is applied on the server too (debounced), so it finds cards that are not loaded.

## How to rerun

```bash
# Browser targets (memory store with the 2x dataset; not part of npm run test:e2e)
npm run build
KH_PERF=1 npm run test:perf                    # asserts the budgets
KH_PERF=1 KH_PERF_RECORD=1 npm run test:perf   # record only
KH_PERF=1 KH_LOAD_ITEMS=50000 npm run test:perf   # heavier board

# Postgres: full 2x scale (400k items), EXPLAIN ANALYZE + index and time checks
bash supabase/tests/run-load-tests.sh
# CI size (also runs in the GitHub Actions `rls` job)
KH_LOAD_TOTAL=20000 KH_LOAD_BIG=5000 bash supabase/tests/run-load-tests.sh
# Against an existing database (superuser): migrations + seed applied first
psql "$DB" -v items_total=400000 -f supabase/tests/load.sql
psql "$DB" -v max_ms=500 -f supabase/tests/load-check.sql
```

Both scripts use `DATABASE_URL` when it is set, otherwise a temporary local Postgres 16 on
`KH_PG_PORT` (see `supabase/tests/lib.sh`). Never run `load.sql` against production: it bulk-inserts
with triggers disabled (`session_replication_role = replica`).

## Not covered here

- Other views that still read a whole project with `useItems` (list, backlog, overview, RAID linking)
  are fine at 10k items but are the next candidates for paging.
- Real-time fan-out at 150 concurrent users needs a Supabase load test, not a local one.
