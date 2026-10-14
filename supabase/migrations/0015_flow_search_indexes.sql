-- KH-46 [PERF-01] Search and board performance at 2× scale (400,000 work items, 120 projects).
-- Measured with supabase/tests/load.sql + load-check.sql; see docs/performance.md.
--
-- Finding: with Row Level Security on, Postgres will not use an index for a user-supplied
-- condition whose functions are not LEAKPROOF, because it must apply the RLS policy first.
-- `tsvector @@ tsquery` (ts_match_vq) and lower() are not leakproof, so as `authenticated` both
-- global item search and comment search fell back to a sequential scan of every row, however
-- good the GIN index. (As the table owner, which bypasses RLS, the same query used the index,
-- which is why it looked fine in ad-hoc testing.) Marking built-ins LEAKPROOF needs a superuser,
-- which a managed Supabase project does not have.
--
-- Fix: two SECURITY DEFINER candidate functions do the indexed full-text lookup and apply the
-- SAME visibility rules as the work_items / comments select policies (0001), returning only ids
-- and ranks. Callers then read the rows through the normal tables, so RLS is still enforced on
-- every returned row (defence in depth: a mistake here can only drop rows, never leak them).
--
-- Inside them the visible project ids are taken once as an array (an InitPlan): a SQL function is
-- planned generically, and with `in (select visible_project_ids())` the planner picked a nested
-- loop that re-ran visible_project_ids() for every candidate row (2.7 s for 8k matches).

-- Global search also matches `lower(key) = lower(q)`; index it so the two arms combine in a
-- BitmapOr instead of forcing a scan.
create index if not exists work_items_key_lower_idx on public.work_items (lower(key));

-- Comment search: expression index matching to_tsvector('english', body) exactly.
create index if not exists comments_body_search_idx on public.comments
  using gin (to_tsvector('english'::regconfig, body));

-- Top matching work items the caller may see, best first. Mirrors policy work_items_select:
-- project visible (visible_project_ids) and (internal, or shared and not deleted); deleted items
-- are excluded for everyone, as in lib/data/postgres.ts search(). Optional type / status /
-- visibility filters are applied before the limit so filtered searches still fill the page.
create or replace function public.search_work_item_ids(
  p_query text,
  p_limit integer default 50,
  p_types text[] default null,
  p_statuses text[] default null,
  p_visibility text default null
)
returns table (id uuid, rank real)
language sql stable security definer set search_path = public, pg_temp
rows 50 -- tells the caller's planner to fetch the rows by primary key, not scan and hash
as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq, lower(btrim(p_query)) as k)
  select w.id, ts_rank(w.search_vector, q.tsq) as rank
  from public.work_items w, q
  where (w.search_vector @@ q.tsq or lower(w.key) = q.k)
    and w.deleted_at is null
    and w.project_id = any (array(select public.visible_project_ids()))
    and ((select public.is_internal()) or w.visibility = 'shared')
    and (p_types is null or w.type::text = any (p_types))
    and (p_statuses is null or w.status::text = any (p_statuses))
    and (p_visibility is null or w.visibility::text = p_visibility)
  order by rank desc, w.position, w.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Most recent matching comments on work items the caller may see. Mirrors policy comments_select
-- (internal, or shared comment whose parent item is visible) plus the parent item's own policy.
create or replace function public.search_comment_ids(p_query text, p_limit integer default 20)
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp
rows 20 -- as above: the caller re-reads ~20 comments by primary key under RLS
as $$
  select c.id
  from public.comments c
  join public.work_items w on w.id = c.entity_id and w.deleted_at is null
  where c.entity_type = 'work_item'
    and to_tsvector('english', c.body) @@ websearch_to_tsquery('english', p_query)
    and c.project_id = any (array(select public.visible_project_ids()))
    and w.project_id = any (array(select public.visible_project_ids()))
    and ((select public.is_internal()) or (c.visibility = 'shared' and w.visibility = 'shared'))
  order by c.created_at desc, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

revoke execute on function public.search_work_item_ids(text, integer, text[], text[], text),
  public.search_comment_ids(text, integer) from public, anon;
grant execute on function public.search_work_item_ids(text, integer, text[], text[], text),
  public.search_comment_ids(text, integer) to authenticated, service_role;
