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

  -- Restricted project: membership is not enough without US-person status. (0011 refuses the
  -- membership itself; triggers are bypassed here to model a legacy row and prove RLS still hides RVB.)
  perform tests.as_owner();
  set local session_replication_role = replica;
  insert into public.project_members (project_id, user_id) values (tests.rvb(), tests.uid('assoc'));
  set local session_replication_role = origin;
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
  perform tests.throws(format($q$insert into public.gate_reviews (project_id, phase_id, decision, conditions, decided_by)
                                 values (%L, %L, 'approved_with_conditions', 'x', %L)$q$, tests.ehr(), md5('p_ehr_ph3')::uuid,
                              tests.uid('sponsor')), 'sponsor decision without fresh re-auth');
  perform tests.as_owner();
  insert into public.reauth_events (user_id) values (tests.uid('sponsor'));
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

-- ===========================================================================
-- 9. RAID register (0003): decisions, issue SLA, residual score, escalation bookkeeping, links.
-- ===========================================================================
begin;
do $$
declare
  v_id uuid;
  v_upd timestamptz;
begin
  -- Business-day math (2026-10-16 is a Friday).
  perform tests.ok(public.add_business_days('2026-10-16 15:00+00', 1) = '2026-10-19 15:00+00', 'Fri + 1 bd = Mon');
  perform tests.ok(public.add_business_days('2026-10-17 09:00+00', 10) = '2026-10-30 09:00+00', 'Sat + 10 bd = 2nd Fri');

  perform tests.as_user('lead');
  insert into public.raid_entries (project_id, kind, title, severity, created_at)
  values (tests.ehr(), 'issue', 'Critical issue', 'critical', '2026-10-16 15:00+00') returning id into v_id;
  perform tests.ok((select sla_due_at = '2026-10-18 15:00+00' from public.raid_entries where id = v_id), 'critical SLA is 48h');
  update public.raid_entries set severity = 'major' where id = v_id;
  perform tests.ok((select sla_due_at = '2026-10-23 15:00+00' from public.raid_entries where id = v_id), 'major SLA is 5 business days');

  -- Escalation bookkeeping does not count as an update (staleness is preserved).
  select updated_at into v_upd from public.raid_entries where id = v_id;
  update public.raid_entries set escalated_at = now() where id = v_id;
  perform tests.ok((select updated_at = v_upd from public.raid_entries where id = v_id), 'escalated_at keeps updated_at');
  update public.raid_entries set description = 'Vendor replied' where id = v_id;
  perform tests.ok((select updated_at > v_upd from public.raid_entries where id = v_id), 'real edit bumps updated_at');

  -- Decisions and residual score.
  insert into public.raid_entries (project_id, kind, title, decided_by, rationale, entry_date, status)
  values (tests.ehr(), 'decision', 'Two-wave go-live', tests.uid('lead'), 'Halves support load', '2026-10-01', 'closed')
  returning id into v_id;
  perform tests.ok(v_id is not null, 'decision entry inserted');
  insert into public.raid_entries (project_id, kind, title, probability, impact, residual_probability, residual_impact)
  values (tests.ehr(), 'risk', 'Residual', 4, 4, 2, 3) returning id into v_id;
  perform tests.ok((select escalate and score = 16 and residual_score = 6 from public.raid_entries where id = v_id),
                   'residual score generated');

  -- Links: both ends must be visible; clients read only; no cross-project links.
  perform tests.eq(tests.count('raid_links', format('project_id = %L', tests.ehr())), 2, 'lead sees both EHR links');
  insert into public.raid_links (project_id, raid_id, item_id) values (tests.ehr(), v_id, tests.item('EHR-16'));
  perform tests.throws(format('insert into public.raid_links (project_id, raid_id, item_id) values (%L, %L, %L)',
                              tests.ehr(), v_id, tests.item('RVB-2')), 'cross-project RAID link');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('raid_links', format('project_id = %L', tests.ehr())), 1,
                   'sponsor sees only the link between shared entry and shared item');
  perform tests.throws(format('insert into public.raid_links (project_id, raid_id, item_id) values (%L, %L, %L)',
                              tests.ehr(), md5('rd_ehr_1')::uuid, tests.item('EHR-9')), 'client links RAID entry');
  update public.raid_entries set title = 'Edited by client' where id = md5('rd_ehr_1')::uuid;
  perform tests.eq(tests.count('raid_entries', 'title = ''Edited by client'''), 0, 'client edit of RAID entry is a no-op');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('raid_links'), 1, 'rsponsor sees the shared RVB link only');
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('raid_links', format('project_id = %L', tests.rvb())), 0, 'associate sees no RVB links');
end $$;
rollback;

-- ===========================================================================
-- 10. Sprints and timeline (0002_sprints_timeline): Lead/Admin plan sprints, one active sprint
--    per project, end after start, hours-per-point, epic planned dates.
-- ===========================================================================
begin;
do $$
declare
  n int;
begin
  -- Everyone on the project reads sprints; clients and team members cannot change them.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('sprints', format('project_id = %L', tests.ehr())), 3, 'sponsor reads EHR sprints');
  update public.sprints set name = 'hacked' where id = md5('s_ehr3')::uuid;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'sponsor renamed a sprint');

  perform tests.as_user('dev');
  perform tests.eq(tests.count('sprints', format('project_id = %L', tests.ehr())), 3, 'dev reads EHR sprints');
  update public.sprints set status = 'completed' where id = md5('s_ehr2')::uuid;
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'team member completed a sprint');
  perform tests.throws(format($q$insert into public.sprints (project_id, phase_id, name, start_date, end_date)
                                 values (%L, %L, 'Dev sprint', '2026-11-02', '2026-11-13')$q$,
                              tests.ehr(), md5('p_ehr_ph3')::uuid),
                       'team member creates a sprint');
  -- ...but can still move items into a sprint.
  update public.work_items set sprint_id = md5('s_ehr3')::uuid where id = tests.item('EHR-11');
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'team member moves an item into a sprint');

  -- Lead plans sprints; end must be after start.
  perform tests.as_user('lead');
  insert into public.sprints (project_id, phase_id, name, start_date, end_date, capacity_hours)
  values (tests.ehr(), md5('p_ehr_ph3')::uuid, 'EHR Sprint 4', '2026-11-02', '2026-11-13', 200);
  perform tests.eq(tests.count('sprints', 'name = ''EHR Sprint 4'''), 1, 'lead creates a sprint');
  perform tests.throws(format($q$insert into public.sprints (project_id, phase_id, name, start_date, end_date)
                                 values (%L, %L, 'Zero-length', '2026-11-02', '2026-11-02')$q$,
                              tests.ehr(), md5('p_ehr_ph3')::uuid),
                       'sprint ending on its start date');
  perform tests.throws(format($q$insert into public.sprints (project_id, phase_id, name, start_date, end_date, capacity_hours)
                                 values (%L, %L, 'Negative', '2026-11-02', '2026-11-13', -1)$q$,
                              tests.ehr(), md5('p_ehr_ph3')::uuid),
                       'negative sprint capacity');

  -- One active sprint per project: Sprint 3 cannot start while Sprint 2 is active.
  perform tests.throws(format('update public.sprints set status = ''active'' where id = %L', md5('s_ehr3')::uuid),
                       'second active sprint in EHR');
  update public.sprints set status = 'completed' where id = md5('s_ehr2')::uuid;
  update public.sprints set status = 'active' where id = md5('s_ehr3')::uuid;
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'lead starts Sprint 3 after completing Sprint 2');
  perform tests.eq(tests.count('sprints', format('project_id = %L and status = ''active''', tests.ehr())), 1,
                   'exactly one active EHR sprint');

  -- The Lead of EHR is not the Lead of PSR (Admin leads it): no sprint writes there.
  perform tests.throws(format($q$insert into public.sprints (project_id, name, start_date, end_date)
                                 values (%L, 'PSR sprint', '2026-11-02', '2026-11-13')$q$, tests.psr()),
                       'lead creates a sprint on a project they do not lead');

  -- Hours per point: defaults to 6, managers may change it, within range.
  perform tests.ok((select hours_per_point = 6 from public.projects where id = tests.ehr()), 'default 6 h per point');
  update public.projects set hours_per_point = 8 where id = tests.ehr();
  perform tests.ok((select hours_per_point = 8 from public.projects where id = tests.ehr()), 'lead sets hours per point');
  perform tests.throws(format('update public.projects set hours_per_point = 0 where id = %L', tests.ehr()),
                       'zero hours per point');

  -- Epic planned dates (timeline drag): both or neither, end not before start.
  update public.work_items set planned_start = '2026-09-21', planned_end = '2026-11-13' where id = tests.item('EHR-1');
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'lead schedules an epic');
  perform tests.throws(format($q$update public.work_items set planned_start = '2026-11-13', planned_end = '2026-09-21'
                                 where id = %L$q$, tests.item('EHR-2')), 'epic planned end before start');
  perform tests.throws(format($q$update public.work_items set planned_start = '2026-11-13' where id = %L$q$,
                              tests.item('EHR-2')), 'epic planned start without end');

  perform tests.as_user('dev');
  update public.projects set hours_per_point = 2 where id = tests.ehr();
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'team member changes hours per point');
end $$;
rollback;

-- ===========================================================================
-- 11. Client requests go through create_client_request() (0004_client_request_rpc.sql).
-- ===========================================================================
begin;
do $$
declare
  v public.work_items;
begin
  perform tests.as_user('cmember');
  v := public.create_client_request(tests.ehr(), 'Please add a referral field');
  perform tests.ok(v.type = 'client_request' and v.visibility = 'shared' and v.status = 'backlog',
                   'client request is a shared backlog client_request');
  perform tests.ok(v.key = 'EHR-' || v.number and v.reporter_id = tests.uid('cmember'), 'client request key + reporter');
  perform tests.eq(tests.count('work_items', format('id = %L', v.id)), 1, 'client sees own request');
  perform tests.eq(tests.count('activity', format('item_id = %L', v.id)), 1, 'client sees request activity');
  perform tests.throws(format('select public.create_client_request(%L, %L)', tests.rvb(), 'x'),
                       'Peachtree member raises a request on Riverbend');
  perform tests.throws(format('select public.create_client_request(%L, %L)', tests.ehr(), '  '),
                       'blank client request title');
  perform tests.as_user('cviewer');
  perform tests.throws(format('select public.create_client_request(%L, %L)', tests.ehr(), 'x'),
                       'viewer raises a request');
  perform tests.as_user('dev');
  perform tests.throws(format('select public.create_client_request(%L, %L)', tests.ehr(), 'x'),
                       'internal user calls the client request RPC');
  perform tests.ok(not has_function_privilege('anon', 'public.create_client_request(uuid, text, text, public.priority)', 'execute'),
                   'anon cannot execute create_client_request');
end $$;
rollback;

-- ===========================================================================
-- 12. Gate review flow and deliverable acceptance (0005_gates_deliverables.sql).
-- ===========================================================================
begin;
do $$
declare
  v_review public.gate_reviews;
  v_del public.deliverables;
  v_ph3 uuid := md5('p_ehr_ph3')::uuid;
  v_ph4 uuid := md5('p_ehr_ph4')::uuid;
  v_dl uuid := md5('dl_ehr_1')::uuid;
  v_c1 uuid;
  v_c2 uuid;
begin
  -- Only the Lead requests review; open criteria block it unless overridden.
  perform tests.as_user('dev');
  perform tests.throws(format('select public.request_gate_review(%L, %L)', v_ph3, 'note'), 'team member requests review');
  perform tests.as_user('lead');
  perform tests.throws(format('select public.request_gate_review(%L)', v_ph3), 'review with open criteria, no override');
  perform tests.throws(format('select public.request_gate_review(%L, %L)', v_ph4, 'note'), 'review of a not-started phase');
  update public.gate_criteria set done = true where phase_id = v_ph3;
  v_review := public.request_gate_review(v_ph3, null, null, false);
  perform tests.ok(v_review.status = 'pending' and v_review.requested_by = tests.uid('lead'), 'review is pending');
  perform tests.ok((select status = 'ready_for_review' from public.phases where id = v_ph3), 'phase ready for review');
  perform tests.throws(format('select public.request_gate_review(%L)', v_ph3), 'second pending review');
  perform tests.eq(tests.count('gate_review_budgets', format('review_id = %L', v_review.id)), 1, 'lead sees gate budget');

  -- Visibility: own-org sponsor sees the review but not the unshared budget; other orgs see nothing.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('gate_reviews', format('id = %L', v_review.id)), 1, 'sponsor sees pending review');
  perform tests.eq(tests.count('gate_review_budgets', format('review_id = %L', v_review.id)), 0,
                   'sponsor cannot see unshared budget');
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('gate_review_budgets', format('review_id = %L', v_review.id)), 0, 'associate sees budget');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('gate_reviews', format('id = %L', v_review.id)), 0, 'other client sees review');
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'other org sponsor decides');

  -- Only the sponsor decides, and only with a fresh re-auth the client cannot forge.
  perform tests.as_owner();
  insert into public.reauth_events (user_id) values (tests.uid('cmember'));
  perform tests.as_user('cmember');
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'client member decides gate');
  perform tests.as_user('lead');
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'lead decides gate');
  perform tests.as_user('sponsor');
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'decision without re-auth');
  perform tests.throws(format('insert into public.reauth_events (user_id) values (%L)', tests.uid('sponsor')),
                       'client forges a re-auth event');
  perform tests.as_owner();
  insert into public.reauth_events (user_id, at) values (tests.uid('sponsor'), now() - interval '16 minutes');
  perform tests.as_user('sponsor');
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'stale re-auth');
  perform tests.as_owner();
  insert into public.reauth_events (user_id) values (tests.uid('sponsor'));
  perform tests.as_user('sponsor');
  perform tests.throws(format('select public.decide_gate(%L, ''approved_with_conditions'')', v_review.id),
                       'conditional approval without conditions');
  perform tests.throws(format('select public.decide_gate(%L, ''rejected'')', v_review.id), 'rejection without reason');
  v_review := public.decide_gate(v_review.id, 'approved_with_conditions', array['Fix duplicate MRNs', ' '], null,
                                 '203.0.113.9');
  perform tests.ok(v_review.decided_by = tests.uid('sponsor') and host(v_review.ip) = '203.0.113.9'
                   and v_review.decided_at is not null, 'decision is name-, time- and IP-stamped');
  perform tests.eq(cardinality(v_review.condition_item_keys), 1, 'one condition item');
  perform tests.ok((select status = 'approved_with_conditions' from public.phases where id = v_ph3), 'phase approved');
  perform tests.ok((select status = 'active' from public.phases where id = v_ph4), 'next phase active');
  perform tests.eq(tests.count('work_items', format($q$key = %L and type = 'task' and visibility = 'shared'
                                                       and 'gate-condition' = any(labels)$q$,
                                                    v_review.condition_item_keys[1])), 1,
                   'condition is a shared tracked task the sponsor sees');
  update public.gate_reviews set decision = 'rejected' where id = v_review.id;
  perform tests.throws(format('select public.decide_gate(%L, ''approved'')', v_review.id), 'decide twice');
  perform tests.as_owner();
  perform tests.ok((select decision = 'approved_with_conditions' from public.gate_reviews where id = v_review.id),
                   'decisions cannot be rewritten');
  perform tests.eq((select count(*) from public.audit_log where action = 'gate.decide'
                    and entity_id = v_review.id::text and host(ip) = '203.0.113.9'), 1, 'decision audited with IP');

  -- Deliverables: client reviewers accept/reject each criterion; a rejection reopens linked items.
  insert into public.deliverable_criteria (project_id, deliverable_id, text, position)
  values (tests.ehr(), v_dl, 'Appointment types mapped', 1) returning id into v_c1;
  insert into public.deliverable_criteria (project_id, deliverable_id, text, position)
  values (tests.ehr(), v_dl, 'Variance under 0.5%', 2) returning id into v_c2;
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('deliverable_criteria', format('deliverable_id = %L', v_dl)), 0,
                   'other client sees deliverable criteria');
  perform tests.throws(format('select public.decide_deliverable_criterion(%L, ''accepted'')', v_c1),
                       'other org accepts');
  perform tests.as_user('cviewer');
  perform tests.throws(format('select public.decide_deliverable_criterion(%L, ''accepted'')', v_c1), 'viewer accepts');
  perform tests.as_user('sponsor');
  update public.deliverable_criteria set status = 'accepted' where id = v_c1;
  perform tests.ok((select status = 'pending' from public.deliverable_criteria where id = v_c1),
                   'client cannot update criteria directly');
  perform tests.as_user('cmember');
  v_del := public.decide_deliverable_criterion(v_c1, 'accepted', null, '198.51.100.1');
  perform tests.ok(v_del.status = 'submitted', 'one of two accepted stays awaiting acceptance');
  perform tests.as_user('sponsor');
  v_del := public.decide_deliverable_criterion(v_c2, 'rejected', 'Telehealth types missing', '203.0.113.9');
  perform tests.ok(v_del.status = 'rejected', 'any rejection rejects the deliverable');
  perform tests.throws(format('select public.decide_deliverable_criterion(%L, ''accepted'')', v_c2),
                       'decide a rejected deliverable');
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.work_items where id in (tests.item('EHR-6'), tests.item('EHR-7'),
                      tests.item('EHR-18')) and status = 'in_progress'), 3, 'linked items reopened to In Progress');
  perform tests.eq((select count(*) from public.audit_log where action = 'deliverable.criterion_decide'
                    and entity_id = v_dl::text), 2, 'acceptance decisions audited');
  perform tests.ok((select decided_by = tests.uid('sponsor') and host(ip) = '203.0.113.9'
                    from public.deliverable_criteria where id = v_c2), 'criterion decision stamped');
end $$;
rollback;

-- ===========================================================================
-- 13. Insight: executive dashboard RAG override, budget sharing, EV weights (0006_insight_dashboard.sql).
-- ===========================================================================
begin;
do $$
declare who text;
begin
  -- A RAG change needs a reason; the Lead's override is audited with before/after.
  perform tests.as_user('lead');
  perform tests.throws(format('update public.projects set rag = ''red'', rag_reason = '' '' where id = %L', tests.ehr()),
                       'RAG override without a reason');
  update public.projects set rag = 'red', rag_reason = '  UAT slipped a week ' where id = tests.ehr();
  perform tests.ok((select rag = 'red' and rag_reason = 'UAT slipped a week' from public.projects where id = tests.ehr()),
                   'lead overrides RAG (reason trimmed)');
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.audit_log where action = 'project.rag_override'
                    and entity_id = tests.ehr()::text and actor_id = tests.uid('lead')
                    and after ->> 'rag' = 'red' and before ->> 'rag' is not null), 1, 'RAG override audited');

  -- Only managers change it: RLS silently filters everyone else.
  foreach who in array array['team', 'dev', 'assoc', 'sponsor', 'cmember'] loop
    perform tests.as_user(who);
    update public.projects set rag = 'green', rag_reason = 'x', share_budget = true where id = tests.ehr();
  end loop;
  perform tests.as_owner();
  perform tests.ok((select rag = 'red' and not share_budget from public.projects where id = tests.ehr()),
                   'non-managers cannot change RAG or budget sharing');
  perform tests.eq((select count(*) from public.audit_log where action in ('project.rag_override', 'dashboard.share_budget')
                    and entity_id = tests.ehr()::text), 1, 'no audit rows from blocked updates');

  -- Budget stays hidden from clients until the Lead shares it; then only that org's clients see it.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('project_financials'), 0, 'sponsor reads budget before sharing');
  perform tests.as_user('lead');
  update public.projects set share_budget = true where id = tests.ehr();
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.audit_log where action = 'dashboard.share_budget'
                    and entity_id = tests.ehr()::text and after ->> 'shareBudget' = 'true'), 1, 'budget sharing audited');
  foreach who in array array['sponsor', 'cmember', 'cviewer'] loop
    perform tests.as_user(who);
    perform tests.eq(tests.count('project_financials', format('project_id = %L', tests.ehr())), 1,
                     who || ' reads shared EHR budget');
    perform tests.eq(tests.count('project_financials'), 1, who || ' reads only the shared project budget');
  end loop;
  perform tests.as_user('sponsor');
  perform tests.throws(format('insert into public.project_financials values (%L, 1)', tests.psr()),
                       'client writes financials after sharing');
  update public.project_financials set bac = 1 where project_id = tests.ehr();
  perform tests.as_owner();
  perform tests.ok((select bac > 1 from public.project_financials where project_id = tests.ehr()),
                   'client cannot change a shared budget');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('project_financials'), 0, 'other client reads shared budget');
  foreach who in array array['team', 'dev', 'assoc'] loop
    perform tests.as_user(who);
    perform tests.eq(tests.count('project_financials'), 0, who || ' reads budget because it is shared');
  end loop;
  perform tests.ok(not has_function_privilege('anon', 'public.can_see_shared_budget(uuid)', 'execute'),
                   'anon cannot execute can_see_shared_budget');

  -- EV weights are positive when set.
  perform tests.as_user('lead');
  update public.deliverables set ev_weight = 25 where id = md5('dl_ehr_1')::uuid;
  perform tests.ok((select ev_weight = 25 from public.deliverables where id = md5('dl_ehr_1')::uuid), 'lead sets EV weight');
  perform tests.throws(format('update public.deliverables set ev_weight = 0 where id = %L', md5('dl_ehr_1')::uuid),
                       'zero EV weight');
end $$;
rollback;

-- ===========================================================================
-- 16. Shield: mark_mfa_enabled() and record_reauth() (0009_shield_reauth_mfa.sql).
-- ===========================================================================
begin;
do $$
declare
  v_cm uuid := tests.uid('cmember');
  v_cv uuid := tests.uid('cviewer');
begin
  -- A signed-in user at aal1 cannot flag MFA; the flag is unchanged.
  perform tests.as_user('cmember');
  perform tests.throws('select public.mark_mfa_enabled()', 'mark MFA without aal2');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cm, 'aal', 'aal1')::text, true);
  perform tests.throws('select public.mark_mfa_enabled()', 'mark MFA at aal1');
  -- Users still cannot set the flag directly (profiles_guard), even on their own row.
  perform tests.throws(format('update public.profiles set mfa_enabled = true where id = %L', v_cm),
                       'direct update of own mfa_enabled');
  perform tests.as_owner();
  perform tests.ok((select not mfa_enabled from public.profiles where id = v_cm), 'flag unchanged before aal2');

  -- At aal2 it flips the caller's own row only, and is idempotent.
  perform tests.as_user('cmember');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cm, 'aal', 'aal2')::text, true);
  perform tests.ok(public.mark_mfa_enabled(), 'mark MFA at aal2 returns true');
  perform tests.ok(public.mark_mfa_enabled(), 'mark MFA is idempotent');
  perform tests.as_owner();
  perform tests.ok((select mfa_enabled from public.profiles where id = v_cm), 'caller flagged');
  perform tests.ok((select not mfa_enabled from public.profiles where id = v_cv), 'other users untouched');
  perform tests.eq((select count(*) from public.profiles where mfa_enabled and role::text like 'client%'), 1,
                   'exactly one client row changed');
  perform tests.eq((select count(*) from public.audit_log where action = 'profile.mfa_enabled'
                    and entity_id = v_cm::text and actor_id = v_cm), 1, 'MFA enrolment audited once');
  -- A claims sub for another user cannot redirect it: auth.uid() is the caller.
  perform tests.as_user('cviewer');
  perform set_config('request.jwt.claims', json_build_object('sub', v_cm, 'aal', 'aal2')::text, true);
  perform public.mark_mfa_enabled();
  perform tests.as_owner();
  perform tests.ok((select mfa_enabled from public.profiles where id = v_cv), 'viewer flagged only themselves');
  perform tests.ok(not has_function_privilege('anon', 'public.mark_mfa_enabled()', 'execute'),
                   'anon cannot execute mark_mfa_enabled');

  -- record_reauth: server-only. Signed-in users cannot record a re-auth for themselves or others.
  perform tests.ok(not has_function_privilege('authenticated', 'public.record_reauth(uuid, timestamptz)', 'execute'),
                   'authenticated cannot execute record_reauth');
  perform tests.ok(not has_function_privilege('anon', 'public.record_reauth(uuid, timestamptz)', 'execute'),
                   'anon cannot execute record_reauth');
  perform tests.as_user('sponsor');
  perform tests.throws(format('select public.record_reauth(%L, now())', tests.uid('sponsor')),
                       'sponsor records own re-auth');
  perform tests.ok(not public.has_fresh_reauth(), 'no fresh re-auth for the sponsor');
  -- The server (owner role) records a fresh one; stale or future times are ignored.
  perform tests.as_owner();
  perform tests.ok(not public.record_reauth(tests.uid('sponsor'), now() - interval '16 minutes'), 'stale re-auth ignored');
  perform tests.ok(not public.record_reauth(tests.uid('sponsor'), now() + interval '5 minutes'), 'future re-auth ignored');
  perform tests.ok(public.record_reauth(tests.uid('sponsor'), now()), 'fresh re-auth recorded');
  perform tests.ok(public.record_reauth(tests.uid('sponsor'), now()), 'same re-auth recorded twice');
  perform tests.eq((select count(*) from public.reauth_events where user_id = tests.uid('sponsor')), 1,
                   're-auth deduplicated');
  perform tests.as_user('sponsor');
  perform tests.ok(public.has_fresh_reauth(), 'sponsor has a fresh re-auth');
  perform tests.as_user('cmember');
  perform tests.ok(not public.has_fresh_reauth(), 'a re-auth is per user');
end $$;
rollback;

-- ===========================================================================
-- 14. Pulse: status history and weekly status reports (0007_pulse.sql).
-- ===========================================================================
begin;
do $$
declare
  v_item uuid := tests.item('EHR-8');
  v_rep uuid;
begin
  -- Every status change is recorded by the trigger; history is internal-only and cannot be forged.
  perform tests.as_user('dev');
  update public.work_items set status = 'in_review' where id = v_item;
  perform tests.eq(tests.count('status_history', format(
    $q$item_id = %L and from_status = 'ready' and to_status = 'in_review' and changed_by = %L$q$,
    v_item, tests.uid('dev'))), 1, 'status change recorded with actor');
  update public.work_items set title = title || ' (renamed)' where id = v_item;
  perform tests.eq(tests.count('status_history', format('item_id = %L', v_item)), 1, 'non-status edit not recorded');
  perform tests.throws(format($q$insert into public.status_history (project_id, item_id, to_status)
                                 values (%L, %L, 'done')$q$, tests.ehr(), v_item), 'forge status history');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('status_history'), 0, 'client sees status history');

  -- Team members draft; only the project Lead or an Admin publishes.
  perform tests.as_user('team');
  insert into public.status_reports (project_id, period_start, period_end, rag, author_id)
  values (tests.ehr(), '2026-10-12', '2026-10-16', 'amber', tests.uid('team')) returning id into v_rep;
  insert into public.status_report_drafts (report_id, project_id, sections)
  values (v_rep, tests.ehr(), '{"scope": "<p>Draft</p>"}');
  perform tests.ok((select status = 'draft' and week_start = '2026-10-12' from public.status_reports where id = v_rep),
                   'draft for the week of Oct 12');
  perform tests.throws(format($q$insert into public.status_reports (project_id, period_start, period_end, rag, author_id)
                                 values (%L, '2026-10-14', '2026-10-16', 'green', %L)$q$, tests.ehr(), tests.uid('team')),
                       'second report for the same week');
  perform tests.throws(format($q$update public.status_reports set visibility = 'shared' where id = %L$q$, v_rep),
                       'team member publishes');
  perform tests.throws(format($q$update public.status_reports set published_at = now() where id = %L$q$, v_rep),
                       'team member sets published_at');
  perform tests.throws(format($q$insert into public.status_reports (project_id, period_start, period_end, rag, author_id,
                                 visibility) values (%L, '2026-10-19', '2026-10-23', 'green', %L, 'shared')$q$,
                              tests.ehr(), tests.uid('team')), 'team member inserts a published report');
  perform tests.throws(format($q$insert into public.status_report_budgets (report_id, project_id, html)
                                 values (%L, %L, 'x')$q$, v_rep, tests.ehr()), 'team member writes the budget');

  -- Clients never see drafts or the internal working copy.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('status_reports', format('id = %L', v_rep)), 0, 'client sees a draft');
  perform tests.eq(tests.count('status_report_drafts'), 0, 'client sees working copies');

  -- The Lead publishes: shared, stamped, audited, and every client user of the org notified.
  perform tests.as_user('lead');
  insert into public.status_report_budgets (report_id, project_id, html) values (v_rep, tests.ehr(), '<p>$480,000</p>');
  update public.status_reports set published_at = now(), sections = '{"scope": "<p>Client copy</p>"}' where id = v_rep;
  perform tests.ok((select visibility = 'shared' and status = 'published' and published_by = tests.uid('lead')
                    from public.status_reports where id = v_rep), 'published report is shared and stamped');
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.notifications where kind = 'status_report_published'
                    and link = format('/portal/EHR/reports/%s', v_rep)), 3, 'every Peachtree client user notified');
  perform tests.eq((select count(*) from public.audit_log where action = 'status_report.publish'
                    and entity_id = v_rep::text and actor_id = tests.uid('lead')), 1, 'publish audited');

  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('status_reports', format('id = %L', v_rep)), 1, 'sponsor sees the published report');
  perform tests.eq(tests.count('status_report_budgets'), 0, 'sponsor sees the unshared budget');
  perform tests.eq(tests.count('status_report_drafts'), 0, 'sponsor sees the internal working copy');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('status_reports', format('id = %L', v_rep)), 0, 'other client sees the report');
  perform tests.as_user('team');
  perform tests.eq(tests.count('status_report_budgets'), 0, 'team member sees the budget');
  perform tests.throws(format($q$update public.status_reports set rag = 'red' where id = %L$q$, v_rep),
                       'team member edits a published report');
end $$;
rollback;

-- ===========================================================================
-- 15. Signal: item watchers, per-kind notification channels and client-safe notifications
--     (0008_signal.sql).
-- ===========================================================================
begin;
do $$
declare
  v_internal uuid;
  v_shared uuid;
begin
  perform tests.as_owner();
  select id into v_internal from public.work_items
   where project_id = tests.ehr() and visibility = 'internal' and deleted_at is null order by number limit 1;
  select id into v_shared from public.work_items
   where project_id = tests.ehr() and visibility = 'shared' and deleted_at is null order by number limit 1;
  perform tests.ok(v_internal is not null and v_shared is not null, 'seed has internal and shared EHR items');

  -- Watching: anyone who can see an item may watch it; clients only shared items of their org.
  perform tests.as_user('sponsor');
  insert into public.item_watchers (item_id, user_id) values (v_shared, tests.uid('sponsor'));
  perform tests.eq(tests.count('item_watchers', format('item_id = %L', v_shared)), 1, 'sponsor watches a shared item');
  perform tests.throws(format('insert into public.item_watchers (item_id, user_id) values (%L, %L)',
                              v_internal, tests.uid('sponsor')), 'client watches an internal item');
  perform tests.throws(format('insert into public.item_watchers (item_id, user_id) values (%L, %L)',
                              v_shared, tests.uid('cmember')), 'client subscribes someone else');
  perform tests.throws(format('insert into public.item_watchers (item_id, user_id) values (%L, %L)',
                              tests.item('RVB-2'), tests.uid('sponsor')), 'client watches another org''s item');

  -- Internal staff auto-watch colleagues (the assignee), but never a client on an internal item.
  perform tests.as_user('lead');
  insert into public.item_watchers (item_id, user_id) values (v_internal, tests.uid('dev'));
  perform tests.throws(format('insert into public.item_watchers (item_id, user_id) values (%L, %L)',
                              v_internal, tests.uid('sponsor')), 'lead subscribes a client to an internal item');
  perform tests.ok(tests.count('item_watchers', format('item_id = %L', v_shared)) >= 1, 'staff see watchers');

  -- Clients only ever see their own watch rows, and nothing on internal items.
  perform tests.as_user('cmember');
  perform tests.eq(tests.count('item_watchers'), 0, 'client member sees other people''s watches');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('item_watchers'), 0, 'other org sees Peachtree watchers');
  perform tests.as_user('dev');
  update public.item_watchers set watching = false where item_id = v_internal and user_id = tests.uid('dev');
  perform tests.ok((select not watching from public.item_watchers where item_id = v_internal
                    and user_id = tests.uid('dev')), 'unwatch keeps an explicit row');
  update public.item_watchers set watching = false where user_id = tests.uid('sponsor');
  perform tests.as_owner();
  perform tests.ok((select watching from public.item_watchers where item_id = v_shared
                    and user_id = tests.uid('sponsor')), 'nobody edits someone else''s watch');

  -- Channel preferences are personal and validated.
  perform tests.as_user('sponsor');
  insert into public.notification_channel_prefs (user_id, kind, channel)
  values (tests.uid('sponsor'), 'gate_requested', 'email');
  perform tests.throws(format('insert into public.notification_channel_prefs (user_id, kind, channel) values (%L, ''mention'', ''off'')',
                              tests.uid('lead')), 'set another user''s preference');
  perform tests.throws(format('insert into public.notification_channel_prefs (user_id, kind, channel) values (%L, ''mention'', ''pager'')',
                              tests.uid('sponsor')), 'unknown channel');
  perform tests.as_user('lead');
  perform tests.eq(tests.count('notification_channel_prefs'), 0, 'lead sees the sponsor''s preferences');

  -- Client safety: internal notifications (and internal-only kinds) never reach a client.
  perform tests.throws(format('insert into public.notifications (user_id, project_id, kind, title, visibility) values (%L, %L, ''mention'', ''x'', ''internal'')',
                              tests.uid('sponsor'), tests.ehr()), 'internal mention to a client');
  perform tests.throws(format('insert into public.notifications (user_id, project_id, kind, title, visibility) values (%L, %L, ''risk_escalated'', ''x'', ''shared'')',
                              tests.uid('sponsor'), tests.ehr()), 'risk escalation to a client');
  insert into public.notifications (user_id, project_id, kind, title, visibility)
  values (tests.uid('sponsor'), tests.ehr(), 'gate_requested', 'Gate 3 ready for approval', 'shared');
  insert into public.notifications (user_id, project_id, kind, title, visibility)
  values (tests.uid('dev'), tests.ehr(), 'mention', 'Lara mentioned you', 'internal');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('notifications', 'kind = ''gate_requested'''), 1, 'sponsor gets the shared notification');
  perform tests.throws(format('update public.notifications set visibility = ''internal'' where user_id = %L',
                              tests.uid('sponsor')), 'client notification flipped to internal');
end $$;
rollback;

-- ===========================================================================
-- 18. Capacity: weekly allocations, grid totals, directory tags and the U.S.-person rule on
--     restricted projects (0011_capacity.sql).
-- ===========================================================================
begin;
do $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_tue date := date_trunc('week', current_date)::date + 1;
begin
  -- Restricted RVB: a Lead's direct writes putting the non-U.S. associate on it are refused.
  perform tests.as_user('lead');
  perform tests.throws(format('insert into public.project_members (project_id, user_id, project_role, allocation_pct) values (%L, %L, ''Integration'', 50)',
                              tests.rvb(), tests.uid('assoc')), 'lead adds non-US member to restricted RVB');
  perform tests.throws(format('insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours) values (%L, %L, %L, %L, 0, 8)',
                              tests.rvb(), tests.uid('assoc'), v_week, v_week + 6), 'lead allocates non-US person on RVB');
  perform tests.throws(format('update public.work_items set assignee_id = %L where id = %L',
                              tests.uid('assoc'), tests.item('RVB-1')), 'lead assigns non-US person to an RVB item');
  perform tests.throws(format('insert into public.work_items (project_id, type, title, reporter_id, assignee_id) values (%L, ''task'', ''x'', %L, %L)',
                              tests.rvb(), tests.uid('lead'), tests.uid('assoc')), 'lead creates an RVB item for a non-US assignee');
  perform tests.eq(tests.count('project_members', format('project_id = %L and user_id = %L', tests.rvb(), tests.uid('assoc'))), 0,
                   'no non-US member on RVB');
  -- U.S. persons are fine on RVB; non-US people are fine on unrestricted projects.
  insert into public.project_members (project_id, user_id, project_role, allocation_pct)
  values (tests.rvb(), tests.uid('team'), 'QA', 10);
  update public.work_items set assignee_id = tests.uid('team') where id = tests.item('RVB-1');
  update public.work_items set assignee_id = tests.uid('assoc') where id = tests.item('EHR-12');
  perform tests.ok((select assignee_id = tests.uid('assoc') from public.work_items where id = tests.item('EHR-12')),
                   'non-US assignee on unrestricted EHR');

  -- Even the table owner cannot bypass the rule.
  perform tests.as_owner();
  perform tests.throws(format('insert into public.project_members (project_id, user_id) values (%L, %L)',
                              tests.rvb(), tests.uid('assoc')), 'owner adds non-US member to RVB');

  -- Flipping to restricted is refused while non-U.S. people are on the project, naming them.
  perform tests.as_user('lead');
  begin
    update public.projects set restricted = true where id = tests.ehr();
    perform tests.ok(false, 'EHR flipped to restricted with a non-US member');
  exception when check_violation then
    perform tests.ok(sqlerrm like '%remove these non-U.S. people first: Sam Rivera.', 'flip refusal lists Sam Rivera: ' || sqlerrm);
  end;
  perform tests.as_user('admin');
  update public.projects set restricted = true where id = tests.psr();
  perform tests.ok((select restricted from public.projects where id = tests.psr()), 'admin restricts PSR (US people only)');

  -- An admin cannot clear the U.S.-person flag of someone on a restricted project.
  perform tests.throws(format('update public.profiles set us_person = false where id = %L', tests.uid('dev')),
                       'clear US flag of an RVB member');
  update public.profiles set us_person = false where id = tests.uid('cmember');
  perform tests.ok((select not us_person from public.profiles where id = tests.uid('cmember')), 'admin clears a free person''s flag');
end $$;
rollback;

begin;
do $$
declare
  v_week date := date_trunc('week', current_date)::date;
  v_row public.allocations;
begin
  -- Weekly rows: Monday start, Sunday end, pct derived from hours / capacity, one per week.
  perform tests.as_user('lead');
  insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours)
  values (tests.ehr(), tests.uid('team'), v_week + 84, v_week, 0, 30) returning * into v_row;
  perform tests.ok(v_row.end_date = v_row.start_date + 6, 'allocation end_date is the Sunday');
  perform tests.ok(v_row.pct = 75, format('pct derived from hours (got %s)', v_row.pct));
  perform tests.throws(format('insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours) values (%L, %L, %L, %L, 0, 8)',
                              tests.ehr(), tests.uid('team'), v_week + 85, v_week + 91), 'allocation not on a Monday');
  perform tests.throws(format('insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours) values (%L, %L, %L, %L, 0, 8)',
                              tests.ehr(), tests.uid('team'), v_week + 84, v_week + 90), 'duplicate weekly allocation');
  perform tests.throws(format('insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours) values (%L, %L, %L, %L, 0, 8)',
                              tests.psr(), tests.uid('team'), v_week + 84, v_week + 90), 'lead writes allocations on PSR (not theirs)');
  perform tests.as_user('team');
  update public.allocations set hours = 1 where project_id = tests.ehr();
  perform tests.eq(tests.count('allocations', format('project_id = %L and hours = 1', tests.ehr())), 0, 'team edit had no effect');

  -- Grid totals cover every project (PSR is invisible to the Lead) but only for planning roles.
  perform tests.as_user('lead');
  perform tests.eq(tests.count('allocations', format('project_id = %L', tests.psr())), 0, 'lead sees no PSR allocations');
  perform tests.ok((select hours = 32 from public.capacity_week_totals(v_week, v_week) where user_id = tests.uid('team')),
                   'lead sees Tiara''s total of 32 h including PSR');
  perform tests.ok((select hours = 48 from public.capacity_week_totals(v_week + 14, v_week + 14) where user_id = tests.uid('dev')),
                   'seeded spike: dev at 48 h in the third week');
  perform tests.as_user('team');
  perform tests.ok(exists (select 1 from public.capacity_week_totals(v_week, v_week)), 'team member reads grid totals');
  perform tests.as_user('assoc');
  perform tests.eq((select count(*) from public.capacity_week_totals(v_week, v_week + 77)), 0, 'associate reads grid totals');
  perform tests.as_user('sponsor');
  perform tests.eq((select count(*) from public.capacity_week_totals(v_week, v_week + 77)), 0, 'client reads grid totals');
  perform tests.eq(tests.count('allocations'), 0, 'client sees allocations');

  -- Directory tags: Leads and Admins edit skills / certifications of internal staff only.
  perform tests.as_user('lead');
  perform public.set_person_tags(tests.uid('team'), '{QA,Accessibility}', '{ISTQB}');
  perform tests.ok((select skills = '{QA,Accessibility}' and certifications = '{ISTQB}' from public.profiles
                    where id = tests.uid('team')), 'lead edits skills and certifications');
  perform tests.throws(format('select public.set_person_tags(%L, ''{x}'', null)', tests.uid('sponsor')), 'lead tags a client');
  update public.profiles set certifications = '{x}' where id = tests.uid('team');
  perform tests.ok((select certifications = '{ISTQB}' from public.profiles where id = tests.uid('team')),
                   'lead cannot edit another profile directly');
  perform tests.as_user('team');
  perform tests.throws(format('select public.set_person_tags(%L, ''{x}'', null)', tests.uid('dev')), 'team member edits tags');
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('profile_rates'), 0, 'associate reads cost rates');
end $$;
rollback;

-- ===========================================================================
-- 20. Shield: Postgres data path for the Sprint 3 domains (0013_shield_sprint3_postgres.sql).
-- ===========================================================================
begin;
do $$
declare
  v_j jsonb;
  who text;
begin
  -- Server-only helpers: signed-in users and anon cannot execute them.
  foreach who in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_function_privilege(who, 'public.user_can_see_project(uuid, uuid)', 'execute'),
                     who || ' cannot execute user_can_see_project');
    perform tests.ok(not has_function_privilege(who, 'public.project_evm_inputs(uuid)', 'execute'),
                     who || ' cannot execute project_evm_inputs');
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.project_evm_inputs(uuid)', 'execute'),
                   'service_role executes project_evm_inputs');
  perform tests.as_user('dev');
  perform tests.throws(format('select public.project_evm_inputs(%L)', tests.ehr()), 'team member reads EVM inputs');
  perform tests.throws(format('select public.user_can_see_project(%L, %L)', tests.uid('rsponsor'), tests.ehr()),
                       'signed-in user probes project access of another user');

  -- user_can_see_project mirrors canSeeProject for any user.
  perform tests.as_owner();
  perform tests.ok(public.user_can_see_project(tests.uid('lead'), tests.ehr()), 'lead sees EHR');
  perform tests.ok(public.user_can_see_project(tests.uid('sponsor'), tests.ehr()), 'sponsor sees own org project');
  perform tests.ok(not public.user_can_see_project(tests.uid('rsponsor'), tests.ehr()), 'other org never sees EHR');
  perform tests.ok(not public.user_can_see_project(tests.uid('assoc'), tests.rvb()), 'associate does not see RVB');
  perform tests.ok(public.user_can_see_project(tests.uid('admin'), tests.rvb()), 'admin sees every project');
  perform tests.ok(not public.user_can_see_project(gen_random_uuid(), tests.ehr()), 'unknown user sees nothing');

  -- EVM inputs: BAC in cents, actual cost = approved hours x cost rate, EV baseline from weighted deliverables.
  v_j := public.project_evm_inputs(tests.ehr());
  perform tests.eq((v_j ->> 'bac_cents')::bigint, 48000000, 'EHR BAC in cents');
  perform tests.eq(coalesce((select sum((a ->> 'amount_cents')::bigint)::bigint from jsonb_array_elements(v_j -> 'actuals') a), 0),
                   coalesce((select round(sum(t.hours * r.cost_rate) * 100)::bigint from public.time_entries t
                    join public.profile_rates r on r.profile_id = t.user_id
                    where t.project_id = tests.ehr() and t.status = 'approved'), 0),
                   'actual cost is approved time x cost rate');
  perform tests.ok(exists (select 1 from public.time_entries t where t.project_id = tests.ehr() and t.status <> 'approved'),
                   'EHR has unapproved time that must not count');
  perform tests.eq(jsonb_array_length(v_j -> 'milestones'), 0, 'no EV milestones without weights');
  update public.deliverables set ev_weight = 2 where project_id = tests.ehr();
  v_j := public.project_evm_inputs(tests.ehr());
  perform tests.eq(jsonb_array_length(v_j -> 'milestones'), 1, 'weighted deliverable becomes an EV milestone');
  perform tests.eq((v_j -> 'milestones' -> 0 ->> 'percent_complete')::int, 0, 'not accepted: 0% complete');

  -- The project Lead reads the dashboard audit trail of a project they manage (not other audit rows).
  perform tests.as_user('lead');
  perform set_config('kh.client_ip', '203.0.113.7', true);
  update public.projects set rag = 'amber', rag_reason = 'Vendor slipped' where id = tests.ehr();
  perform set_config('kh.client_ip', 'not-an-ip', true);
  update public.projects set share_budget = true where id = tests.ehr();
  perform tests.eq(tests.count('audit_log', format('entity_id = %L and action = ''project.rag_override''', tests.ehr())), 1,
                   'lead reads the RAG audit of their project');
  perform tests.eq(tests.count('audit_log', format('entity_id = %L and action = ''dashboard.share_budget''', tests.ehr())), 1,
                   'lead reads the budget-sharing audit');
  perform tests.eq(tests.count('audit_log', 'action = ''project.create'''), 0, 'lead reads no other audit rows');
  insert into public.audit_log (actor_id, project_id, action, entity, entity_id)
  values (tests.uid('lead'), tests.ehr(), 'dashboard.export_pdf', 'project', tests.ehr()::text);
  perform tests.eq(tests.count('audit_log', format('entity_id = %L and action = ''dashboard.export_pdf''', tests.ehr())), 1,
                   'lead reads the PDF export audit');
  foreach who in array array['team', 'dev', 'assoc', 'sponsor', 'rsponsor'] loop
    perform tests.as_user(who);
    perform tests.eq(tests.count('audit_log'), 0, who || ' reads no dashboard audit');
  end loop;
  perform tests.as_owner();
  perform tests.ok((select ip = '203.0.113.7'::inet from public.audit_log where action = 'project.rag_override'
                    and entity_id = tests.ehr()::text), 'RAG override audit records the client IP');
  perform tests.ok((select ip is null from public.audit_log where action = 'dashboard.share_budget'
                    and entity_id = tests.ehr()::text), 'an invalid IP is dropped, not an error');

  -- The internal RAG reason of a report lives in the internal working copy.
  perform tests.as_user('lead');
  update public.status_report_drafts set rag_reason = 'Internal: vendor dispute' where report_id = md5('sr_ehr_1')::uuid;
  perform tests.eq(tests.count('status_report_drafts', 'rag_reason is not null'), 1, 'lead reads internal RAG reason');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('status_report_drafts'), 0, 'sponsor reads no working copy');
  perform tests.eq(tests.count('status_reports', 'rag_reason like ''Internal%'''), 0, 'client copy keeps its reason');
end $$;
rollback;

-- ===========================================================================
-- 17. Portal: workspace settings, pending invites and client isolation in the portal
--     (0010_portal_onboarding.sql).
-- ===========================================================================
begin;
do $$
declare
  v_org uuid;
begin
  -- Everyone signed in reads the single workspace row (it brands the portal); only Admins write.
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('workspace_settings'), 1, 'client reads workspace branding');
  update public.workspace_settings set name = 'Hijacked' where id;
  perform tests.as_user('lead');
  update public.workspace_settings set name = 'Lead rename' where id;
  perform tests.as_owner();
  perform tests.ok((select name from public.workspace_settings) not in ('Hijacked', 'Lead rename'),
                   'non-admins cannot change workspace settings');
  perform tests.as_user('admin');
  update public.workspace_settings set name = 'Konnector Delivery', onboarded_at = now(),
         logo_url = '/clients/konnector.svg' where id;
  perform tests.ok((select name from public.workspace_settings) = 'Konnector Delivery', 'admin renames the workspace');
  perform tests.throws('update public.workspace_settings set logo_url = ''javascript:alert(1)'' where id',
                       'workspace logo must be an image URL');
  perform tests.throws('insert into public.workspace_settings (id) values (false)', 'a second workspace row');
  perform tests.throws('delete from public.workspace_settings', 'admin deletes the workspace row');

  -- The wizard's first client: Admins create client orgs with a logo; leads cannot.
  insert into public.organizations (name, type, logo_url) values ('Wizard Client', 'client', '/clients/wizard.svg')
  returning id into v_org;
  perform tests.ok(v_org is not null, 'admin creates a client org');
  perform tests.as_user('lead');
  perform tests.throws('insert into public.organizations (name, type) values (''Lead Client'', ''client'')',
                       'lead creates a client org');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('organizations', format('id = %L', v_org)), 0, 'client sees a new org with no shared project');

  -- Invites: Admin only, Konnector roles only, lower-case unique emails, invited_by is the caller.
  perform tests.as_user('admin');
  insert into public.invites (email, role) values ('new.dev@konnectortech.com', 'team_member');
  perform tests.eq(tests.count('invites'), 1, 'admin records a pending invite');
  perform tests.throws('insert into public.invites (email, role) values (''new.dev@konnectortech.com'', ''associate'')',
                       'duplicate invite');
  perform tests.throws('insert into public.invites (email, role) values (''Upper@konnectortech.com'', ''team_member'')',
                       'invite email not lower-case');
  perform tests.throws('insert into public.invites (email, role) values (''sponsor2@client.example'', ''client_sponsor'')',
                       'invite with a client role');
  perform tests.throws(format('insert into public.invites (email, invited_by) values (''x@konnectortech.com'', %L)',
                              tests.uid('lead')), 'invite forged as someone else');
  perform tests.as_user('lead');
  perform tests.eq(tests.count('invites'), 0, 'lead cannot see invites');
  perform tests.throws('insert into public.invites (email) values (''lead.invite@konnectortech.com'')',
                       'lead records an invite');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('invites'), 0, 'client cannot see invites');

  -- Portal isolation: Riverbend sees no Peachtree project, item, deliverable, gate review or report.
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('projects', format('id in (%L, %L)', tests.ehr(), tests.psr())), 0,
                   'riverbend sees no Peachtree project');
  perform tests.eq(tests.count('work_items', format('project_id in (%L, %L)', tests.ehr(), tests.psr())), 0,
                   'riverbend sees no Peachtree work');
  perform tests.eq(tests.count('deliverables', format('project_id = %L', tests.ehr())), 0,
                   'riverbend sees no Peachtree deliverable');
  perform tests.eq(tests.count('gate_reviews', format('project_id = %L', tests.ehr())), 0,
                   'riverbend sees no Peachtree gate review');
  perform tests.eq(tests.count('status_reports', format('project_id = %L', tests.ehr())), 0,
                   'riverbend sees no Peachtree status report');
  perform tests.eq(tests.count('organizations', 'name = ''Peachtree Clinic Group'''), 0,
                   'riverbend sees no Peachtree org (logo included)');
  perform tests.throws(format('select public.create_client_request(%L, %L)', tests.ehr(), 'Cross-org request'),
                       'riverbend files a request into a Peachtree project');
end $$;
rollback;

-- ===========================================================================
-- 19. Ledger: time tracking lifecycle, approved time as actual cost, permission-change audit
--     (0012_ledger.sql).
-- ===========================================================================
begin;
do $$
declare
  v_id uuid;
  v_other uuid;
  v_ac0 bigint;
begin
  -- Only internal people log time; associates only on assigned projects; quarter hours only.
  perform tests.as_user('assoc');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours) values (%L, %L, %L, ''2027-01-13'', 1)',
                              tests.rvb(), tests.item('RVB-2'), tests.uid('assoc')), 'associate logs on an unassigned project');
  perform tests.as_user('sponsor');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours) values (%L, %L, %L, ''2027-01-13'', 1)',
                              tests.ehr(), tests.item('EHR-7'), tests.uid('sponsor')), 'client logs time');
  perform tests.as_user('lead');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours) values (%L, %L, %L, ''2027-01-13'', 1)',
                              tests.ehr(), tests.item('EHR-7'), tests.uid('sponsor')), 'lead logs time for a client user');
  v_ac0 := public.project_actual_cost(tests.ehr(), '2027-01-31');

  perform tests.as_user('dev');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours) values (%L, %L, %L, ''2027-01-13'', 0.3)',
                              tests.ehr(), tests.item('EHR-7'), tests.uid('dev')), 'non-quarter hours');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours) values (%L, %L, %L, ''2027-01-13'', 1)',
                              tests.ehr(), tests.item('RVB-3'), tests.uid('dev')), 'item from another project');
  perform tests.throws(format('insert into public.time_entries (project_id, item_id, user_id, entry_date, hours, status) values (%L, %L, %L, ''2027-01-13'', 1, ''approved'')',
                              tests.ehr(), tests.item('EHR-7'), tests.uid('dev')), 'insert pre-approved time');
  insert into public.time_entries (project_id, item_id, user_id, entry_date, hours, note)
  values (tests.ehr(), tests.item('EHR-7'), tests.uid('dev'), '2027-01-13', 2.5, 'Dry-run') returning id into v_id;
  perform tests.ok((select status = 'draft' from public.time_entries where id = v_id), 'new time is a draft');
  perform tests.ok(public.item_logged_hours(tests.item('EHR-7')) >= 2.5, 'item total includes the new entry');
  perform tests.throws('select public.project_actual_cost(tests.ehr(), ''2027-01-31'')', 'team member reads actual cost');
  -- The owner cannot approve their own time.
  perform tests.throws(format('update public.time_entries set status = ''approved'' where id = %L', v_id), 'owner approves own time');
  update public.time_entries set status = 'submitted' where id = v_id;
  perform tests.ok((select submitted_at is not null from public.time_entries where id = v_id), 'submitted_at set');
  perform tests.throws(format('update public.time_entries set hours = 3 where id = %L', v_id), 'owner edits submitted time');
  perform tests.throws(format('delete from public.time_entries where id = %L', v_id), 'owner deletes submitted time');

  -- Other team members never see someone else's time; clients see none and get no item totals.
  perform tests.as_user('team');
  perform tests.eq(tests.count('time_entries', format('id = %L', v_id)), 0, 'team member sees a colleague''s time');
  perform tests.ok(public.item_logged_hours(tests.item('EHR-7')) >= 2.5, 'team member sees the item total');
  update public.time_entries set status = 'approved' where id = v_id;  -- invisible row: no effect
  perform tests.as_user('sponsor');
  perform tests.throws(format('select public.item_logged_hours(%L)', tests.item('EHR-7')), 'client reads logged hours');
  perform tests.eq(tests.count('time_entries'), 0, 'client sees time entries');

  -- The Lead rejects with a reason; the owner edits (back to draft) and resubmits; the Lead approves.
  perform tests.as_user('lead');
  perform tests.ok((select status = 'submitted' from public.time_entries where id = v_id), 'team member could not approve');
  perform tests.throws(format('update public.time_entries set status = ''rejected'' where id = %L', v_id), 'reject without a reason');
  update public.time_entries set status = 'rejected', reject_reason = 'Split by ticket' where id = v_id;
  perform tests.ok((select decided_by = tests.uid('lead') from public.time_entries where id = v_id), 'decided_by is the lead');
  perform tests.as_user('dev');
  update public.time_entries set hours = 2.5, note = 'Dry-run (EHR-7 only)' where id = v_id;
  perform tests.ok((select status = 'draft' from public.time_entries where id = v_id), 'editing rejected time makes a draft');
  update public.time_entries set status = 'submitted' where id = v_id;
  perform tests.as_user('lead');
  update public.time_entries set status = 'approved' where id = v_id;
  perform tests.eq(public.project_actual_cost(tests.ehr(), '2027-01-31') - v_ac0, 23750,
                   'approved 2.5 h x $95 adds $237.50 to actual cost');
  perform tests.eq(public.project_actual_cost(tests.ehr(), '2027-01-12') - v_ac0, 0, 'cost counts from the entry date');
  perform tests.eq(tests.count('profile_rates'), 0, 'lead still cannot read cost rates');

  -- Approved time is locked for everyone, even the table owner.
  perform tests.throws(format('update public.time_entries set hours = 1 where id = %L', v_id), 'lead edits approved time');
  perform tests.throws(format('update public.time_entries set status = ''rejected'', reject_reason = ''x'' where id = %L', v_id),
                       'lead rejects approved time');
  perform tests.as_user('dev');
  perform tests.throws(format('delete from public.time_entries where id = %L', v_id), 'owner deletes approved time');
  perform tests.as_owner();
  perform tests.throws(format('delete from public.time_entries where id = %L', v_id), 'table owner deletes approved time');

  -- Decisions are audited in the database.
  perform tests.eq(tests.count('audit_log', format('entity = ''time_entry'' and entity_id = %L and action = ''time.reject''', v_id)), 1,
                   'rejection audited');
  perform tests.eq(tests.count('audit_log', format('entity = ''time_entry'' and entity_id = %L and action = ''time.approve'' and actor_id = %L',
                                                   v_id, tests.uid('lead'))), 1, 'approval audited');

  -- A Lead cannot approve time on a project they don't lead (PSR is led by the Admin).
  perform tests.as_user('team');
  insert into public.time_entries (project_id, item_id, user_id, entry_date, hours)
  values (tests.psr(), tests.item('PSR-1'), tests.uid('team'), '2027-01-13', 1) returning id into v_other;
  update public.time_entries set status = 'submitted' where id = v_other;
  perform tests.as_user('lead');
  perform tests.eq(tests.count('time_entries', format('id = %L', v_other)), 0, 'lead sees time on a project they don''t lead');
  perform tests.as_user('admin');
  update public.time_entries set status = 'approved' where id = v_other;
  perform tests.ok((select status = 'approved' from public.time_entries where id = v_other), 'admin approves any project');

  -- Permission changes are audited: role changes and project membership.
  perform tests.as_user('admin');
  update public.profiles set role = 'delivery_lead' where id = tests.uid('team');
  perform tests.eq(tests.count('audit_log', format('action = ''permission.role_change'' and entity_id = %L and after->>''role'' = ''delivery_lead''',
                                                   tests.uid('team'))), 1, 'role change audited');
  perform tests.as_user('lead');
  insert into public.project_members (project_id, user_id, project_role) values (tests.rvb(), tests.uid('team'), 'QA');
  update public.project_members set project_role = 'QA lead' where project_id = tests.rvb() and user_id = tests.uid('team');
  delete from public.project_members where project_id = tests.rvb() and user_id = tests.uid('team');
  perform tests.as_user('admin');
  perform tests.eq(tests.count('audit_log', format('entity = ''project_member'' and entity_id = %L and project_id = %L and actor_id = %L',
                                                   tests.uid('team'), tests.rvb(), tests.uid('lead'))), 3,
                   'member add / change / remove audited');
end $$;
rollback;

-- ===========================================================================
-- 24. Portal: Admin console (users, invites, templates, workflows, custom fields) and
--     attachments (0017_portal_admin_files.sql).
-- ===========================================================================
begin;
do $$
declare
  v_pid uuid;
  v_field uuid;
  v_att uuid;
  v_peach uuid := 'a0000000-0000-4000-8000-000000000002';
begin
  -- Profiles: roles follow the org type; nobody changes their own role or deactivates themselves.
  perform tests.as_user('admin');
  perform tests.throws(format('update public.profiles set role = ''client_sponsor'' where id = %L', tests.uid('team')),
                       'client role for a Konnector user');
  perform tests.throws(format('update public.profiles set role = ''admin'' where id = %L', tests.uid('sponsor')),
                       'Konnector role for a client user');
  perform tests.throws(format('update public.profiles set role = ''team_member'' where id = %L', tests.uid('admin')),
                       'admin changes their own role');
  perform tests.throws(format('update public.profiles set deactivated_at = now() where id = %L', tests.uid('admin')),
                       'admin deactivates themselves');
  perform tests.as_user('cviewer');
  perform tests.throws(format('update public.profiles set deactivated_at = now() where id = %L', tests.uid('cviewer')),
                       'user deactivates themselves');
  perform tests.as_user('admin');
  update public.profiles set deactivated_at = now() where id = tests.uid('cviewer');
  perform tests.eq(tests.count('audit_log', format('action = ''user.deactivate'' and entity_id = %L', tests.uid('cviewer'))), 1,
                   'deactivation audited');
  perform tests.as_user('cviewer');
  perform tests.eq(tests.count('projects'), 0, 'a deactivated user sees no projects');
  perform tests.eq(tests.count('work_items'), 0, 'a deactivated user sees no items');
  perform tests.ok(public.current_profile_role() is null, 'a deactivated user has no role');

  -- Audit rows record the client IP the app passes for the transaction.
  perform tests.as_user('admin');
  perform set_config('kh.client_ip', '203.0.113.7', true);
  update public.profiles set role = 'client_member' where id = tests.uid('sponsor');
  perform tests.eq(tests.count('audit_log', format('action = ''permission.role_change'' and entity_id = %L and ip = ''203.0.113.7''',
                                                   tests.uid('sponsor'))), 1, 'role change audited with the client IP');
  perform set_config('kh.client_ip', 'not-an-ip', true);
  update public.profiles set role = 'client_sponsor' where id = tests.uid('sponsor');
  perform set_config('kh.client_ip', '', true);

  -- Invites carry an org; the role must fit it.
  insert into public.invites (email, role, org_id) values ('new.member@peachtreeclinic.example', 'client_member', v_peach);
  perform tests.throws(format('insert into public.invites (email, role, org_id) values (''x@peachtreeclinic.example'', ''team_member'', %L)', v_peach),
                       'Konnector role invited into a client org');
  update public.invites set sent_count = sent_count + 1, last_sent_at = now() where email = 'new.member@peachtreeclinic.example';
  perform tests.eq(tests.count('invites', 'sent_count = 1'), 1, 'admin re-sends an invite');
  perform tests.as_user('lead');
  perform tests.eq(tests.count('invites'), 0, 'lead cannot see admin invites');

  -- Templates: Konnector staff read; Admins add custom ones; built-ins are read-only; clients see none.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('templates'), 0, 'client sees templates');
  perform tests.as_user('assoc');
  perform tests.eq(tests.count('templates'), 3, 'staff see the 3 built-in templates');
  perform tests.as_user('lead');
  perform tests.throws($q$insert into public.templates (id, name, phases, raid_categories, created_by)
                          select 'custom-lead', 'Lead template', phases, raid_categories, auth.uid() from public.templates where id = 'advisory'$q$,
                       'lead creates a template');
  perform tests.as_user('admin');
  insert into public.templates (id, name, base_id, phases, raid_categories, created_by)
  values ('custom-retainer', 'Managed Service Retainer', 'kanban-retainer',
          '[{"gate": 1, "name": "Mobilize", "criteria": ["Charter signed"]},
            {"gate": 2, "name": "Plan", "criteria": ["Service catalogue agreed"]},
            {"gate": 3, "name": "Execute", "criteria": ["Quarterly review accepted", "SLA report shared"]},
            {"gate": 4, "name": "Accept", "criteria": ["Runbook accepted"]},
            {"gate": 5, "name": "Transition", "criteria": ["Handover signed"]}]', array['Service'], tests.uid('admin'));
  perform tests.throws($q$insert into public.templates (id, name, phases, raid_categories, created_by)
                          values ('custom-bad', 'Bad template', '[{"gate": 1, "name": "Mobilize", "criteria": []},
                            {"gate": 2, "name": "Plan", "criteria": ["x2"]}, {"gate": 3, "name": "Execute", "criteria": ["x3"]},
                            {"gate": 4, "name": "Accept", "criteria": ["x4"]}, {"gate": 5, "name": "Transition", "criteria": ["x5"]}]',
                            array['Cost'], auth.uid())$q$, 'a gate without exit criteria');
  perform tests.throws($q$insert into public.templates (id, name, phases, raid_categories, created_by)
                          select 'custom-renamed', 'Renamed gates', jsonb_set(phases, '{0,name}', '"Kickoff"'), raid_categories, auth.uid()
                          from public.templates where id = 'advisory'$q$, 'gate names are fixed');
  update public.templates set name = 'Changed' where id = 'kdf-hybrid';
  perform tests.ok((select name from public.templates where id = 'kdf-hybrid') <> 'Changed', 'built-in templates are read-only');
  perform tests.throws($q$update public.templates set phases = (select phases from public.templates where id = 'advisory') where id = 'custom-retainer'$q$,
                       'a template''s gates are immutable');
  perform tests.as_user('lead');
  v_pid := public.create_project_from_template('MSR', 'Managed service', v_peach, tests.uid('lead'), 'custom-retainer');
  perform tests.eq(tests.count('gate_criteria', format('project_id = %L', v_pid)), 6, 'custom template seeds its 6 criteria');
  perform tests.eq(tests.count('gate_criteria', format('project_id = %L and text = ''SLA report shared''', v_pid)), 1,
                   'custom Execute criterion present');
  perform tests.as_user('admin');
  update public.templates set archived_at = now() where id = 'custom-retainer';
  perform tests.as_user('lead');
  perform tests.throws(format('select public.create_project_from_template(''MSR2'', ''x'', %L, %L, ''custom-retainer'')', v_peach, tests.uid('lead')),
                       'archived template starts a project');

  -- Workflows: readable on the project, Admin-only writes; Accepted and the column set are fixed.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('project_workflows'), 2, 'sponsor reads the workflows of the 2 Peachtree projects');
  perform tests.as_user('lead');
  update public.project_workflows set statuses = jsonb_set(statuses, '{0,label}', '"Inbox"') where project_id = tests.ehr();
  perform tests.ok((select statuses -> 0 ->> 'label' from public.project_workflows where project_id = tests.ehr()) = 'Backlog',
                   'lead cannot change a workflow');
  perform tests.as_user('admin');
  update public.project_workflows set statuses = jsonb_set(jsonb_set(statuses, '{2,label}', '"Building"'), '{2,wipLimit}', '3')
  where project_id = tests.ehr();
  perform tests.ok((select statuses -> 2 ->> 'label' from public.project_workflows where project_id = tests.ehr()) = 'Building',
                   'admin renames a column');
  perform tests.throws(format($q$update public.project_workflows set statuses = jsonb_set(statuses, '{6,label}', '"Signed off"') where project_id = %L$q$, tests.ehr()),
                       'Accepted renamed');
  perform tests.throws(format($q$update public.project_workflows set statuses = jsonb_set(statuses, '{6,wipLimit}', '5') where project_id = %L$q$, tests.ehr()),
                       'Accepted WIP-limited');
  perform tests.throws(format($q$update public.project_workflows set statuses = statuses - 6 where project_id = %L$q$, tests.ehr()),
                       'Accepted removed');
  perform tests.throws(format($q$update public.project_workflows set statuses = jsonb_set(statuses, '{1,label}', '"Backlog"') where project_id = %L$q$, tests.ehr()),
                       'duplicate column names');
  perform tests.throws(format($q$update public.project_workflows set statuses = jsonb_set(statuses, '{2,wipLimit}', '0') where project_id = %L$q$, tests.ehr()),
                       'WIP limit below 1');

  -- Custom fields: clients see shared fields and their values on shared items only.
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('custom_fields'), 1, 'sponsor sees only the shared field');
  perform tests.eq(tests.count('custom_field_values', format('item_id = %L', tests.item('EHR-9'))), 1,
                   'sponsor sees the shared value, not the internal Cost centre');
  perform tests.throws(format($q$insert into public.custom_field_values (project_id, item_id, field_id, value)
                                 values (%L, %L, %L, 'Decatur')$q$, tests.ehr(), tests.item('EHR-6'), md5('cf_site')::uuid),
                       'client writes a field value');
  perform tests.as_user('lead');
  perform tests.throws($q$insert into public.custom_fields (name, kind) values ('Lead field', 'text')$q$, 'lead defines a field');
  perform tests.as_user('admin');
  insert into public.custom_fields (name, kind, visibility) values ('Contract line', 'number', 'shared') returning id into v_field;
  perform tests.throws($q$insert into public.custom_fields (name, kind) values ('Choice', 'select')$q$, 'select field without options');
  perform tests.throws($q$insert into public.custom_fields (name, kind) values ('site', 'text')$q$, 'duplicate field name');
  perform tests.throws(format('update public.custom_fields set kind = ''text'' where id = %L', v_field), 'field kind changes');
  perform tests.as_user('dev');
  insert into public.custom_field_values (project_id, item_id, field_id, value) values (tests.ehr(), tests.item('EHR-12'), v_field, '42');
  perform tests.throws(format($q$insert into public.custom_field_values (project_id, item_id, field_id, value)
                                 values (%L, %L, %L, 'forty')$q$, tests.ehr(), tests.item('EHR-6'), v_field), 'non-number value');
  perform tests.throws(format($q$insert into public.custom_field_values (project_id, item_id, field_id, value)
                                 values (%L, %L, %L, 'Atlanta')$q$, tests.ehr(), tests.item('EHR-6'), md5('cf_site')::uuid),
                       'select value not among the options');
  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('custom_field_values', format('item_id = %L', tests.item('EHR-12'))), 0,
                   'sponsor sees a shared field''s value on an internal item');
  perform tests.as_user('admin');
  update public.custom_fields set archived_at = now() where id = v_field;
  perform tests.as_user('dev');
  perform tests.throws(format($q$update public.custom_field_values set value = '7' where field_id = %L$q$, v_field),
                       'value written to an archived field');

  -- Attachments: limits, client uploads always shared, files on internal comments always internal.
  perform tests.as_user('dev');
  insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility, bucket)
  values (tests.ehr(), 'work_item', tests.item('EHR-9'), 'internal.pdf', 'x/internal.pdf', 'application/pdf', 100, tests.uid('dev'), 'internal', 'kh-org-test');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
                                 values (%L, 'work_item', %L, 'big.pdf', 'x/big.pdf', 'application/pdf', 26214401, %L)$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('dev')), 'file over 25 MB');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
                                 values (%L, 'work_item', %L, 'run.exe', 'x/run.exe', 'application/x-msdownload', 10, %L)$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('dev')), 'file type not allowed');
  perform tests.as_user('lead');
  insert into public.attachments (project_id, entity_type, entity_id, comment_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
  values (tests.ehr(), 'work_item', tests.item('EHR-7'), md5('cm_2')::uuid, 'internal-comment.pdf', 'x/c.pdf', 'application/pdf', 10, tests.uid('lead'), 'shared')
  returning id into v_att;
  perform tests.ok((select visibility = 'internal' from public.attachments where id = v_att), 'file on an internal comment is internal');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, comment_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
                                 values (%L, 'work_item', %L, %L, 'wrong.pdf', 'x/w.pdf', 'application/pdf', 10, %L)$q$,
                              tests.ehr(), tests.item('EHR-9'), md5('cm_2')::uuid, tests.uid('lead')), 'comment on another item');
  insert into public.attachments (project_id, entity_type, entity_id, comment_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
  values (tests.ehr(), 'work_item', tests.item('EHR-7'), md5('cm_1')::uuid, 'shared-comment.pdf', 'x/s.pdf', 'application/pdf', 10, tests.uid('lead'), 'shared');

  perform tests.as_user('sponsor');
  perform tests.eq(tests.count('attachments', format('entity_id = %L', tests.item('EHR-9'))), 1,
                   'sponsor sees the shared file on EHR-9, not the internal one');
  perform tests.eq(tests.count('attachments', format('entity_id = %L', tests.item('EHR-7'))), 1,
                   'sponsor sees the file on the shared comment only');
  perform tests.eq(tests.count('attachments', format('id = %L', v_att)), 0, 'sponsor sees a file on an internal comment');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
                                 values (%L, 'work_item', %L, 'c.pdf', 'x/c2.pdf', 'application/pdf', 10, %L, 'internal')$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('sponsor')), 'client uploads an internal file');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, comment_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
                                 values (%L, 'work_item', %L, %L, 'c.pdf', 'x/c3.pdf', 'application/pdf', 10, %L, 'shared')$q$,
                              tests.ehr(), tests.item('EHR-7'), md5('cm_2')::uuid, tests.uid('sponsor')), 'client attaches to an internal comment');
  insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
  values (tests.ehr(), 'work_item', tests.item('EHR-9'), 'sign-off.pdf', 'x/so.pdf', 'application/pdf', 10, tests.uid('sponsor'), 'shared');
  perform tests.as_user('cviewer');
  perform tests.throws(format($q$insert into public.attachments (project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility)
                                 values (%L, 'work_item', %L, 'v.pdf', 'x/v.pdf', 'application/pdf', 10, %L, 'shared')$q$,
                              tests.ehr(), tests.item('EHR-9'), tests.uid('cviewer')), 'viewer uploads');
  perform tests.as_user('rsponsor');
  perform tests.eq(tests.count('attachments', format('project_id = %L', tests.ehr())), 0, 'riverbend sees no Peachtree files');
  perform tests.eq(tests.count('custom_field_values', format('project_id = %L', tests.ehr())), 0, 'riverbend sees no Peachtree values');
  perform tests.eq(tests.count('project_workflows', format('project_id = %L', tests.ehr())), 0, 'riverbend sees no Peachtree workflow');
  perform tests.as_user('team');
  delete from public.attachments where id = v_att;
  perform tests.as_owner();
  perform tests.eq(tests.count('attachments', format('id = %L', v_att)), 1, 'only the uploader or an admin deletes a file');
end $$;
rollback;

select format('PASS: %s assertions', nextval('tests.assertions') - 1) as result;
drop schema tests cascade;
