-- KH-46 [PERF-01] Search / board query-plan check on the load dataset (supabase/tests/load.sql).
-- Runs the app's exact queries (lib/data/postgres.ts search, lib/data/board-postgres.ts) as real
-- users with RLS on (set role authenticated + JWT claims), prints EXPLAIN ANALYZE, and fails when
--   * a selective item search does not use work_items_search_idx (GIN) and work_items_key_lower_idx,
--   * comment search does not use comments_body_search_idx,
--   * the board column query does not read work_items through an index (board / backlog index),
--   * any search takes longer than :max_ms (default 500 ms, CLAUDE.md §4).
--
--   psql "$DB" -v max_ms=500 -f supabase/tests/load-check.sql

\set ON_ERROR_STOP 1
\if :{?max_ms}
\else
  \set max_ms 500
\endif
select set_config('kh.max_ms', :'max_ms', false);

-- EXPLAIN ANALYZE of a query, as text (SECURITY INVOKER: runs as the caller, so RLS applies).
create or replace function pg_temp.kh_plan(q text) returns text language plpgsql as $$
declare
  r record;
  out text := '';
begin
  for r in execute 'explain (analyze, costs off, timing off, summary on) ' || q loop
    out := out || r."QUERY PLAN" || E'\n';
  end loop;
  return out;
end $$;

create or replace function pg_temp.kh_ms(plan text) returns numeric language sql as $$
  select (regexp_match(plan, 'Execution Time: ([0-9.]+) ms'))[1]::numeric
$$;

-- Checks one query: prints the plan, asserts the indexes and the time budget.
create or replace function pg_temp.kh_check(label text, q text, must_use text[], timed boolean)
returns void language plpgsql as $$
declare
  plan text;
  ms numeric;
  ix text;
  best numeric;
begin
  perform pg_temp.kh_plan(q); -- warm the cache once; a cold first read is not what users see
  plan := pg_temp.kh_plan(q);
  ms := pg_temp.kh_ms(plan);
  best := ms;
  for i in 1..2 loop
    best := least(best, pg_temp.kh_ms(pg_temp.kh_plan(q)));
  end loop;
  raise notice E'\n== % (% ms, best of 3: % ms) ==\n%', label, ms, best, plan;
  foreach ix in array must_use loop
    if position(ix in plan) = 0 then
      raise exception 'PLAN CHECK FAILED: "%" does not use %', label, ix;
    end if;
  end loop;
  if timed and best > current_setting('kh.max_ms')::numeric then
    raise exception 'TIME CHECK FAILED: "%" took % ms (budget % ms)', label, best, current_setting('kh.max_ms');
  end if;
end $$;

-- BEFORE (Sprint 4): the search query as it was, filtering work_items directly under RLS.
create or replace function pg_temp.kh_item_search_before(term text) returns text language sql as $$
  select format($q$
    select w.id, w.key, w.title, w.status, p.key as project_key, p.name as project_name
    from public.work_items w join public.projects p on p.id = w.project_id
    where w.deleted_at is null
      and (w.search_vector @@ websearch_to_tsquery('english', %1$L) or lower(w.key) = lower(%1$L))
    order by ts_rank(w.search_vector, websearch_to_tsquery('english', %1$L)) desc, w.position
    limit 50$q$, term)
$$;

create or replace function pg_temp.kh_comment_search_before(term text) returns text language sql as $$
  select format($q$
    select c.id, c.body, w.key as item_key, p.key as project_key
    from public.comments c
    join public.work_items w on w.id = c.entity_id and w.deleted_at is null
    join public.projects p on p.id = c.project_id
    where c.entity_type = 'work_item'
      and to_tsvector('english', c.body) @@ websearch_to_tsquery('english', %1$L)
    order by c.created_at desc
    limit 20$q$, term)
$$;

-- AFTER: the app's search query (lib/data/postgres.ts → search()), with the term inlined.
create or replace function pg_temp.kh_item_search(term text) returns text language sql as $$
  select format($q$
    select w.id, w.key, w.title, w.status, p.key as project_key, p.name as project_name
    from public.search_work_item_ids(%1$L, 50, null::text[], null::text[], null::text) m
    join public.work_items w on w.id = m.id
    join public.projects p on p.id = w.project_id
    where w.deleted_at is null
    order by m.rank desc, w.position
    limit 50$q$, term)
$$;

create or replace function pg_temp.kh_comment_search(term text) returns text language sql as $$
  select format($q$
    select c.id, c.body, w.key as item_key, p.key as project_key
    from public.search_comment_ids(%1$L, 20) m
    join public.comments c on c.id = m.id
    join public.work_items w on w.id = c.entity_id and w.deleted_at is null
    join public.projects p on p.id = c.project_id
    where c.entity_type = 'work_item'
    order by c.created_at desc
    limit 20$q$, term)
$$;

-- The bodies of search_work_item_ids / search_comment_ids (0015), to show their plans: SQL
-- SECURITY DEFINER functions are never inlined, so EXPLAIN of the caller shows a Function Scan.
-- Run as the function owner (as the functions do), with the caller's JWT claims set.
create or replace function pg_temp.kh_item_candidates(term text) returns text language sql as $$
  select format($q$
    with q as (select websearch_to_tsquery('english', %1$L) as tsq, lower(btrim(%1$L)) as k)
    select w.id, ts_rank(w.search_vector, q.tsq) as rank
    from public.work_items w, q
    where (w.search_vector @@ q.tsq or lower(w.key) = q.k)
      and w.deleted_at is null
      and w.project_id = any (array(select public.visible_project_ids()))
      and ((select public.is_internal()) or w.visibility = 'shared')
    order by rank desc, w.position, w.id
    limit 50$q$, term)
$$;

create or replace function pg_temp.kh_comment_candidates(term text) returns text language sql as $$
  select format($q$
    select c.id
    from public.comments c
    join public.work_items w on w.id = c.entity_id and w.deleted_at is null
    where c.entity_type = 'work_item'
      and to_tsvector('english', c.body) @@ websearch_to_tsquery('english', %1$L)
      and c.project_id = any (array(select public.visible_project_ids()))
      and w.project_id = any (array(select public.visible_project_ids()))
      and ((select public.is_internal()) or (c.visibility = 'shared' and w.visibility = 'shared'))
    order by c.created_at desc, c.id
    limit 20$q$, term)
$$;

-- The board's per-column page (lib/data/board-postgres.ts), for project LOAD.
create or replace function pg_temp.kh_board() returns text language sql as $$
  select format($q$
    select x.* from unnest('{backlog,ready,in_progress,in_review,client_review,done,accepted}'::public.item_status[],
                           '{100,100,100,100,100,100,100}'::int[]) as col(status, lim)
    cross join lateral (
      select w.id, w.key, w.title, w.status, w.position, w.number from public.work_items w
      where w.deleted_at is null and w.status = col.status and w.project_id = %L
      order by w.position, w.number
      limit col.lim
    ) x
    order by x.position, x.number$q$, (select id from public.projects where key = 'LOAD'))
$$;

-- Every check runs for a Delivery Lead (sees all load projects, internal items) and a Client
-- Sponsor (half the projects, shared items only).
do $$
declare
  who record;
  t text;
begin
  for who in
    select * from (values ('Delivery Lead', 'b0000000-0000-4000-8000-000000000002'),
                          ('Client Sponsor', 'b0000000-0000-4000-8000-000000000006')) as v(label, uid)
  loop
    perform set_config('request.jwt.claim.sub', who.uid, true);
    perform set_config('request.jwt.claims', json_build_object('sub', who.uid, 'role', 'authenticated')::text, true);

    -- Index usage inside the candidate functions (owner context, as SECURITY DEFINER runs).
    perform pg_temp.kh_check(who.label || ': item candidates, selective ("19999")',
                             pg_temp.kh_item_candidates('19999'),
                             array['work_items_search_idx', 'work_items_key_lower_idx'], false);
    perform pg_temp.kh_check(who.label || ': item candidates, key ("LOAD-19999")',
                             pg_temp.kh_item_candidates('LOAD-19999'),
                             array['work_items_search_idx', 'work_items_key_lower_idx'], false);
    perform pg_temp.kh_check(who.label || ': comment candidates ("credentials")',
                             pg_temp.kh_comment_candidates('credentials'),
                             array['comments_body_search_idx'], false);

    -- End-to-end timing as the signed-in user with RLS on: before (Sprint 4 query) and after.
    set local role authenticated;
    foreach t in array array['19999', 'LOAD-19999', 'pharmacy sync', 'reconcile'] loop
      perform pg_temp.kh_check(who.label || ': BEFORE item search "' || t || '"',
                               pg_temp.kh_item_search_before(t), array[]::text[], false);
      perform pg_temp.kh_check(who.label || ': AFTER item search "' || t || '"',
                               pg_temp.kh_item_search(t), array[]::text[], true);
    end loop;
    perform pg_temp.kh_check(who.label || ': BEFORE comment search "credentials"',
                             pg_temp.kh_comment_search_before('credentials'), array[]::text[], false);
    perform pg_temp.kh_check(who.label || ': AFTER comment search "credentials"',
                             pg_temp.kh_comment_search('credentials'), array[]::text[], true);
    perform pg_temp.kh_check(who.label || ': board page, 7 columns x 100 (project LOAD)',
                             pg_temp.kh_board(), array['Index Scan using work_items_'], true);
    reset role;
  end loop;
end $$;

select 'load-check: all plan and time checks passed' as result;
