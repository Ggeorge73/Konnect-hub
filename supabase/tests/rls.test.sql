-- RLS + business-rule tests. Plain SQL: each DO block raises on the first failure.
-- Runs against a database with auth-stub (or Supabase auth), all migrations and seed.sql applied.
-- Every test runs in a transaction that is rolled back, so tests are independent.

\set ON_ERROR_STOP 1
set client_min_messages = warning;

drop schema if exists tests cascade;
create schema tests;
create sequence tests.assertions;

create table tests.users (name text primary key, id uuid not null);
insert into tests.users values
  ('admin',    'b0000000-0000-4000-8000-000000000001'),
  ('lead',     'b0000000-0000-4000-8000-000000000002'),
  ('team',     'b0000000-0000-4000-8000-000000000003'),
  ('dev',      'b0000000-0000-4000-8000-000000000004'),
  ('assoc',    'b0000000-0000-4000-8000-000000000005'),
  ('sponsor',  'b0000000-0000-4000-8000-000000000006'),
  ('cmember',  'b0000000-0000-4000-8000-000000000007'),
  ('cviewer',  'b0000000-0000-4000-8000-000000000008'),
  ('rsponsor', 'b0000000-0000-4000-8000-000000000009');

create function tests.uid(p_name text) returns uuid language sql stable as $$
  select id from tests.users where name = p_name $$;

create function tests.item(p_key text) returns uuid language sql stable as $$
  select md5('wi_' || lower(replace(p_key, '-', '_')))::uuid $$;

-- Project ids
create function tests.ehr() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-000000000001'::uuid $$;
create function tests.rvb() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-000000000002'::uuid $$;
create function tests.psr() returns uuid language sql immutable as $$ select 'c0000000-0000-4000-8000-000000000003'::uuid $$;

-- Become a signed-in user (transaction-local) / go back to the owner.
create function tests.as_user(p_name text) returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  if tests.uid(p_name) is null then raise exception 'unknown test user %', p_name; end if;
  perform set_config('request.jwt.claim.sub', tests.uid(p_name)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  perform nextval('tests.assertions');
  if p_cond is not true then raise exception 'FAIL: %', p_msg; end if;
end $$;

create function tests.eq(p_got bigint, p_want bigint, p_msg text) returns void language plpgsql as $$
begin
  perform tests.ok(p_got = p_want, format('%s (got %s, want %s)', p_msg, p_got, p_want));
end $$;

-- Asserts the statement raises (any error). The statement's effects are rolled back.
create function tests.throws(p_sql text, p_msg text) returns void language plpgsql as $$
declare
  v_raised boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_raised := true;
  end;
  perform tests.ok(v_raised, 'expected an error: ' || p_msg);
end $$;

-- Rows of a table visible to the current role (optionally filtered).
create function tests.count(p_table text, p_where text default 'true') returns bigint language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from public.%I where %s', p_table, p_where) into v;
  return v;
end $$;

grant usage on schema tests to authenticated;
grant select on all tables in schema tests to authenticated;
grant usage on all sequences in schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ===========================================================================
-- 1. Every table in public has RLS enabled and at least one policy.
-- ===========================================================================
do $$
declare r record;
begin
  for r in
    select c.relname, c.relrowsecurity,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    perform tests.ok(r.relrowsecurity, format('RLS not enabled on public.%s', r.relname));
    perform tests.ok(r.policies > 0, format('no policies on public.%s', r.relname));
  end loop;
  perform tests.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r', 'p')) >= 25, 'expected >= 25 public tables');
  -- anon has no table access at all.
  perform tests.ok(not exists (select 1 from information_schema.role_table_grants
                               where grantee = 'anon' and table_schema = 'public'), 'anon must have no table grants');
end $$;

-- ===========================================================================
-- 2. Tenant isolation: Peachtree users see zero Riverbend rows in every table with project_id.
-- ===========================================================================
begin;
do $$
declare
  r record;
  who text;
  n_tables int := 0;
begin
  for r in
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'project_id' and t.table_type = 'BASE TABLE'
    order by 1
  loop
    n_tables := n_tables + 1;
    -- Sanity: the seed really has Riverbend rows here, so a zero below means RLS hid them.
    perform tests.as_owner();
    perform tests.ok(tests.count(r.table_name, format('project_id = %L', tests.rvb())) > 0,
                     format('seed has no Riverbend rows in %s', r.table_name));
    foreach who in array array['sponsor', 'cmember', 'cviewer'] loop
      perform tests.as_user(who);
      perform tests.eq(tests.count(r.table_name, format('project_id = %L', tests.rvb())), 0,
                       format('%s sees Riverbend rows in %s', who, r.table_name));
    end loop;
  end loop;
  perform tests.ok(n_tables >= 19, format('expected >= 19 project tables, found %s', n_tables));

  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('projects', format('id = %L', tests.rvb())), 0, 'sponsor sees Riverbend project');
  perform tests.eq(tests.count('projects'), 2, 'sponsor sees exactly the 2 Peachtree projects');
  perform tests.eq(tests.count('organizations', 'type = ''client'' and name like ''Riverbend%'''), 0, 'sponsor sees Riverbend org');
  perform tests.eq(tests.count('profiles', format('id = %L', tests.uid('rsponsor'))), 0, 'sponsor sees Riverbend profile');
  perform tests.eq(tests.count('profiles', format('id = %L', tests.uid('lead'))), 1, 'sponsor sees Konnector lead profile');

  -- Positive control: the Riverbend sponsor does see Riverbend (shared) data, and nothing of Peachtree.
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('projects'), 1, 'rsponsor sees only RVB');
  perform tests.eq(tests.count('work_items'), 2, 'rsponsor sees 2 shared RVB items');
  perform tests.eq(tests.count('comments'), 1, 'rsponsor sees 1 shared RVB comment');
  perform tests.eq(tests.count('raid_entries'), 1, 'rsponsor sees 1 shared RVB RAID entry');
  perform tests.eq(tests.count('work_items', format('project_id <> %L', tests.rvb())), 0, 'rsponsor sees Peachtree items');
end $$;
rollback;

-- ===========================================================================
-- 3. Clients never see internal-visibility rows.
-- ===========================================================================
begin;
do $$
declare
  r record;
  who text;
begin
  foreach who in array array['sponsor', 'cmember', 'cviewer'] loop
    perform tests.as_user(who);
    for r in
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'visibility' order by 1
    loop
      perform tests.eq(tests.count(r.table_name, 'visibility = ''internal'''), 0,
                       format('%s sees internal rows in %s', who, r.table_name));
    end loop;
    perform tests.eq(tests.count('work_items'), 18, who || ' sees the 18 shared Peachtree items');
    perform tests.eq(tests.count('comments'), 2, who || ' sees the 2 shared Peachtree comments');
    perform tests.eq(tests.count('comments', format('id = %L', md5('cm_2')::uuid)), 0, who || ' sees internal comment cm_2');
    perform tests.eq(tests.count('attachments'), 1, who || ' sees only the shared attachment');
    perform tests.eq(tests.count('acceptance_criteria', format('item_id = %L', tests.item('EHR-12'))), 0,
                     who || ' sees criteria of an internal item');
    perform tests.eq(tests.count('time_entries'), 0, who || ' sees time entries');
    perform tests.eq(tests.count('allocations'), 0, who || ' sees allocations');
    perform tests.eq(tests.count('audit_log'), 0, who || ' sees audit log');
  end loop;

  -- Internal staff on the project do see internal rows.
  perform tests.as_user('dev');
  perform tests.eq(tests.count('work_items', format('project_id = %L', tests.ehr())), 24, 'dev sees all 24 EHR items');
  perform tests.eq(tests.count('comments', format('project_id = %L', tests.ehr())), 3, 'dev sees all EHR comments');

  -- A shared comment hanging off an internal item stays hidden from clients.
  perform tests.as_owner();
  insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility)
  values (tests.ehr(), 'work_item', tests.item('EHR-12'), tests.uid('dev'), 'shared note on internal item', 'shared');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('comments', format('entity_id = %L', tests.item('EHR-12'))), 0,
                   'sponsor sees a shared comment on an internal item');
end $$;
rollback;

-- ===========================================================================
-- 4. Financials and cost rates.
-- ===========================================================================
begin;
do $$
declare who text;
begin
  foreach who in array array['sponsor', 'cmember', 'cviewer', 'rsponsor', 'team', 'dev', 'assoc'] loop
    perform tests.as_user(who);
    perform tests.eq(tests.count('project_financials'), 0, who || ' reads project_financials');
    perform tests.eq(tests.count('profile_rates'), 0, who || ' reads profile_rates');
  end loop;
  perform tests.as_user('sponsor');
  perform tests.throws(format('insert into public.project_financials values (%L, 1)', tests.ehr()),
                       'sponsor writes financials');
  perform tests.ok(not exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'projects' and column_name in ('bac', 'cost_rate')),
                   'projects must not carry bac');
  perform tests.ok(not exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'profiles' and column_name = 'cost_rate'),
                   'profiles must not carry cost_rate');

  perform tests.as_user('lead');
  perform tests.eq(tests.count('project_financials'), 2, 'lead sees financials of EHR and RVB');
  perform tests.eq(tests.count('profile_rates'), 0, 'lead reads cost rates');
  perform tests.as_user('admin');
  perform tests.eq(tests.count('project_financials'), 3, 'admin sees all financials');
  perform tests.eq(tests.count('profile_rates'), 5, 'admin sees all cost rates');
end $$;
rollback;

-- ===========================================================================
-- 5. Project visibility for internal roles (canSeeProject).
-- ===========================================================================
begin;
do $$
begin
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('projects'), 1, 'associate sees only assigned EHR');
  perform tests.eq(tests.count('projects', format('id = %L', tests.ehr())), 1, 'associate sees EHR');
  perform tests.eq(tests.count('work_items', format('project_id <> %L', tests.ehr())), 0, 'associate sees other items');

  perform tests.as_user('team');
  perform tests.eq(tests.count('projects'), 2, 'team member sees EHR + PSR (assigned)');
  perform tests.as_user('lead');
  perform tests.eq(tests.count('projects'), 2, 'lead sees EHR + RVB (leads)');
  perform tests.as_user('admin');
  perform tests.eq(tests.count('projects'), 3, 'admin sees all projects');

  -- Restricted project: membership is not enough without US-person status.
  perform tests.as_owner();
  insert into public.project_members (project_id, user_id) values (tests.rvb(), tests.uid('assoc'));
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('projects', format('id = %L', tests.rvb())), 0, 'non-US associate sees restricted RVB');
  perform tests.eq(tests.count('work_items', format('project_id = %L', tests.rvb())), 0, 'non-US associate sees RVB items');
  perform tests.ok(not public.can_see_project(tests.rvb()), 'can_see_project(RVB) for non-US associate');
  perform tests.as_user('dev');
  perform tests.eq(tests.count('projects', format('id = %L', tests.rvb())), 1, 'US-person member sees RVB');

  -- Soft-deleted projects: admin only.
  perform tests.as_owner();
  update public.projects set deleted_at = now() where id = tests.psr();
  perform tests.as_user('team');
  perform tests.eq(tests.count('projects', format('id = %L', tests.psr())), 0, 'member sees soft-deleted PSR');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('projects', format('id = %L', tests.psr())), 0, 'client sees soft-deleted PSR');
  perform tests.as_user('admin');
  perform tests.eq(tests.count('projects', format('id = %L', tests.psr())), 1, 'admin sees soft-deleted PSR');
end $$;
rollback;

-- ===========================================================================
-- 6. Item writes and the Accepted rule.
-- ===========================================================================
begin;
do $$
declare
  n int;
  v public.work_items;
begin
  -- Client viewer: no updates, no transitions, no comments.
  perform tests.as_user('cviewer');
  update public.work_items set title = 'hacked' where id = tests.item('EHR-9');
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'client_viewer updated an item');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-9'), 'in_progress'),
                       'client_viewer transitions an item');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-9'), 'accepted'),
                       'client_viewer accepts an item');
  perform tests.throws(format($q$insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility)
                                 values (%L, 'work_item', %L, %L, 'hi', 'shared')$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('cviewer')),
                       'client_viewer comments');

  -- Client sponsor/member cannot edit item fields directly either.
  perform tests.as_user('sponsor');
  update public.work_items set status = 'accepted' where id = tests.item('EHR-9');
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'sponsor updated an item directly');

  -- Team member cannot set Accepted, directly or via the function, even by forging the flag.
  perform tests.as_user('dev');
  perform tests.throws(format('update public.work_items set status = %L where id = %L', 'accepted', tests.item('EHR-9')),
                       'team member sets accepted directly');
  perform tests.throws(format($q$select set_config('konnect.allow_accept', 'on', true);
                                 update public.work_items set status = 'accepted' where id = %L$q$, tests.item('EHR-9')),
                       'team member forges konnect.allow_accept');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-9'), 'accepted'),
                       'team member accepts via function');
  perform tests.throws(format($q$insert into public.work_items (project_id, type, title, reporter_id, status)
                                 values (%L, 'task', 'x', %L, 'accepted')$q$, tests.ehr(), tests.uid('dev')),
                       'team member inserts an accepted item');
  -- ...but can move it anywhere else.
  update public.work_items set status = 'in_progress' where id = tests.item('EHR-9');
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'team member moves item to in_progress');
  update public.work_items set status = 'client_review' where id = tests.item('EHR-9');

  -- Lead: offline acceptance needs a note, and is audited.
  perform tests.as_user('lead');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-10'), 'accepted'),
                       'lead accepts without offline note');
  perform tests.throws(format('select public.transition_work_item(%L, %L, %L)', tests.item('EHR-10'), 'accepted', '   '),
                       'lead accepts with blank note');
  v := public.transition_work_item(tests.item('EHR-10'), 'accepted', 'Grace approved by phone 10 Oct');
  perform tests.ok(v.status = 'accepted', 'lead offline acceptance applied');

  -- Client member cannot touch an internal item, nor move to arbitrary statuses.
  perform tests.as_user('cmember');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-12'), 'accepted'),
                       'client accepts internal item');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-9'), 'done'),
                       'client moves item to done');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-24'), 'in_progress'),
                       'client reopens accepted item');

  -- Riverbend sponsor cannot accept Peachtree work.
  perform tests.as_user('rsponsor');
  perform tests.throws(format('select public.transition_work_item(%L, %L)', tests.item('EHR-9'), 'accepted'),
                       'other-org sponsor accepts EHR item');

  -- Client sponsor accepts.
  perform tests.as_user('sponsor');
  v := public.transition_work_item(tests.item('EHR-9'), 'accepted');
  perform tests.ok(v.status = 'accepted', 'sponsor accepted EHR-9');
  perform tests.eq(tests.count('work_items', format('id = %L and status = ''accepted''', tests.item('EHR-9'))), 1,
                   'sponsor sees EHR-9 accepted');

  perform tests.as_owner();
  perform tests.eq(tests.count('audit_log', format('entity_id = %L and action = ''item.transition'' and actor_id = %L',
                                                   tests.item('EHR-9'), tests.uid('sponsor'))), 1, 'acceptance audited');
  perform tests.eq(tests.count('audit_log', format('entity_id = %L and action = ''item.offline_acceptance'' and after->>''offline_note'' like ''Grace%%''',
                                                   tests.item('EHR-10'))), 1, 'offline acceptance audited with note');
  perform tests.eq(tests.count('activity', format('item_id = %L and action = ''item.accepted''', tests.item('EHR-9'))), 1,
                   'acceptance in activity feed');
end $$;
rollback;

-- ===========================================================================
-- 7. Audit log is append-only.
-- ===========================================================================
begin;
do $$
begin
  perform tests.as_user('admin');
  perform tests.eq(tests.count('audit_log'), 1, 'admin reads audit log');
  perform tests.throws('update public.audit_log set action = ''x''', 'admin updates audit_log');
  perform tests.throws('delete from public.audit_log', 'admin deletes audit_log');
  insert into public.audit_log (actor_id, action, entity) values (tests.uid('admin'), 'test', 'test');
  perform tests.throws(format('insert into public.audit_log (actor_id, action, entity) values (%L, ''x'', ''x'')',
                              tests.uid('lead')), 'admin forges another actor');
  perform tests.as_owner();
  perform tests.throws('update public.audit_log set action = ''x''', 'owner updates audit_log');
  perform tests.throws('delete from public.audit_log', 'owner deletes audit_log');
  perform tests.throws('truncate public.audit_log', 'owner truncates audit_log');
end $$;
rollback;

-- ===========================================================================
-- 8. Item keys, templates, RAID rules, gate reviews, comments, profiles.
-- ===========================================================================
begin;
do $$
declare
  v_id uuid;
  v_key text;
  v_num int;
  v_pid uuid;
begin
  -- Atomic keys: user-supplied numbers are ignored.
  perform tests.as_user('dev');
  insert into public.work_items (project_id, type, title, reporter_id, number, key)
  values (tests.ehr(), 'task', 'New task', tests.uid('dev'), 1, 'EHR-1')
  returning key, number into v_key, v_num;
  perform tests.ok(v_key = 'EHR-25' and v_num = 25, 'first new EHR item is EHR-25, got ' || v_key);
  insert into public.work_items (project_id, type, title, reporter_id)
  values (tests.ehr(), 'task', 'Another', tests.uid('dev')) returning key into v_key;
  perform tests.ok(v_key = 'EHR-26', 'second new EHR item is EHR-26');
  perform tests.throws(format($q$insert into public.work_items (project_id, type, title, reporter_id)
                                 values (%L, 'task', 'x', %L)$q$, tests.psr(), tests.uid('dev')),
                       'dev creates item in a project they cannot see');
  perform tests.as_user('sponsor');
  perform tests.throws(format($q$insert into public.work_items (project_id, type, title, reporter_id, visibility)
                                 values (%L, 'client_request', 'x', %L, 'shared')$q$, tests.ehr(), tests.uid('sponsor')),
                       'client inserts an item directly');

  -- Project from template.
  perform tests.as_user('sponsor');
  perform tests.throws(format($q$select public.create_project_from_template('ZZZ', 'x', %L, %L)$q$,
                              'a0000000-0000-4000-8000-000000000002', tests.uid('lead')), 'client creates project');
  perform tests.as_user('dev');
  perform tests.throws(format($q$select public.create_project_from_template('ZZZ', 'x', %L, %L)$q$,
                              'a0000000-0000-4000-8000-000000000002', tests.uid('lead')), 'team member creates project');
  perform tests.as_user('lead');
  v_pid := public.create_project_from_template('NEW', 'New Project', 'a0000000-0000-4000-8000-000000000002',
                                               tests.uid('lead'), 'kdf-hybrid', 'hybrid', 'fixed_fee', 125000);
  perform tests.eq(tests.count('phases', format('project_id = %L', v_pid)), 5, 'template seeds 5 phases');
  perform tests.eq(tests.count('gate_criteria', format('project_id = %L', v_pid)), 9, 'template seeds 9 criteria');
  perform tests.eq(tests.count('gate_criteria', format('project_id = %L and text = ''Handover signed''', v_pid)), 1,
                   'Transition criteria present');
  perform tests.eq(tests.count('project_financials', format('project_id = %L and bac = 125000', v_pid)), 1, 'bac stored');
  insert into public.work_items (project_id, type, title, reporter_id) values (v_pid, 'epic', 'E', tests.uid('lead'))
  returning key into v_key;
  perform tests.ok(v_key = 'NEW-1', 'first item of new project is NEW-1');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('projects', format('id = %L', v_pid)), 1, 'client sponsor sees new Peachtree project');
  perform tests.eq(tests.count('project_financials', format('project_id = %L', v_pid)), 0, 'client sees new project bac');

  -- RAID rules.
  perform tests.as_user('lead');
  insert into public.raid_entries (project_id, kind, title, probability, impact)
  values (tests.ehr(), 'risk', 'Big risk', 3, 5) returning id into v_id;
  perform tests.ok((select escalate and score = 15 from public.raid_entries where id = v_id), 'score 15 escalates');
  update public.raid_entries set probability = 2 where id = v_id;
  perform tests.ok((select not escalate and score = 10 from public.raid_entries where id = v_id), 'score 10 de-escalates');
  perform tests.throws(format('update public.raid_entries set status = ''closed'' where id = %L', v_id),
                       'close risk without closure note');
  update public.raid_entries set status = 'closed', closure_note = 'Mitigated by vendor patch' where id = v_id;
  perform tests.ok((select status = 'closed' and closed_at is not null from public.raid_entries where id = v_id),
                   'risk closed with note');

  -- Gate reviews: only the client sponsor decides.
  perform tests.throws(format($q$insert into public.gate_reviews (project_id, phase_id, decision, decided_by)
                                 values (%L, %L, 'approved', %L)$q$, tests.ehr(), md5('p_ehr_ph3')::uuid, tests.uid('lead')),
                       'lead records gate decision');
  perform tests.as_user('cmember');
  perform tests.throws(format($q$insert into public.gate_reviews (project_id, phase_id, decision, decided_by)
                                 values (%L, %L, 'approved', %L)$q$, tests.ehr(), md5('p_ehr_ph3')::uuid, tests.uid('cmember')),
                       'client member records gate decision');
  perform tests.as_user('sponsor');
  insert into public.gate_reviews (project_id, phase_id, decision, conditions, decided_by, ip)
  values (tests.ehr(), md5('p_ehr_ph3')::uuid, 'approved_with_conditions', 'Fix EHR-16 first', tests.uid('sponsor'), '203.0.113.10');
  perform tests.throws(format($q$insert into public.gate_reviews (project_id, phase_id, decision, decided_by)
                                 values (%L, %L, 'rejected', %L)$q$, tests.ehr(), md5('p_ehr_ph3')::uuid, tests.uid('sponsor')),
                       'rejection without reason');

  -- Comments: clients may post shared comments only.
  perform tests.throws(format($q$insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility)
                                 values (%L, 'work_item', %L, %L, 'x', 'internal')$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('sponsor')), 'client posts internal comment');
  perform tests.throws(format($q$insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility)
                                 values (%L, 'work_item', %L, %L, 'x', 'shared')$q$,
                              tests.ehr(), tests.item('EHR-12'), tests.uid('sponsor')), 'client comments on internal item');
  insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility)
  values (tests.ehr(), 'work_item', tests.item('EHR-9'), tests.uid('sponsor'), 'Looks good', 'shared');
  perform tests.eq(tests.count('comments', format('entity_id = %L', tests.item('EHR-9'))), 2, 'sponsor sees own comment');

  -- Profiles: no self-escalation.
  perform tests.throws(format('update public.profiles set role = ''admin'' where id = %L', tests.uid('sponsor')),
                       'sponsor escalates own role');
  perform tests.as_user('assoc');
  perform tests.throws(format('update public.profiles set us_person = true where id = %L', tests.uid('assoc')),
                       'associate flips own us_person');
  update public.profiles set timezone = 'Europe/Paris' where id = tests.uid('assoc');
  perform tests.ok((select timezone = 'Europe/Paris' from public.profiles where id = tests.uid('assoc')), 'self profile edit');

  -- Notifications are personal.
  perform tests.as_user('dev');
  perform tests.eq(tests.count('notifications'), 1, 'dev sees only own notifications');
end $$;
rollback;

select format('PASS: %s assertions', nextval('tests.assertions') - 1) as result;
drop schema tests cascade;
