-- KH-46 [PERF-01] 2×-scale load dataset for Postgres, built with generate_series (no client).
-- Mirrors scripts/seed-load.ts (same shapes and status/type weights; the in-memory target).
--
--   psql "$DB" -v projects=120 -v big_items=20000 -v items_total=400000 -f supabase/tests/load.sql
--
-- Defaults: 120 projects (2 × 60), project LOAD with 20,000 items (2 × 10,000), 400,000 items in
-- total (2 × 200,000), one comment per four items (40% internal) and 30 RAID entries per project.
-- Runs as the database owner after migrations + seed.sql. Triggers are skipped for the bulk
-- insert (session_replication_role = replica), so derived columns are written explicitly.
-- Deterministic: ids are md5() of stable names and every attribute is a function of the row.

\if :{?projects}
\else
  \set projects 120
\endif
\if :{?big_items}
\else
  \set big_items 20000
\endif
\if :{?items_total}
\else
  \set items_total 400000
\endif

\set ON_ERROR_STOP 1
\timing on

begin;
set local session_replication_role = replica;
set local work_mem = '256MB';

create temp table _lp on commit drop as
select i as ix,
       md5('load-project-' || i)::uuid as id,
       case when i = 0 then 'LOAD' else 'L' || lpad(i::text, 3, '0') end as key,
       case when i = 0 then :big_items
            else ((:items_total - :big_items) / greatest(:projects - 1, 1))
                 + case when i <= ((:items_total - :big_items) % greatest(:projects - 1, 1)) then 1 else 0 end
       end as n_items,
       date '2026-07-01' + (i * 7) % 60 as start_date
from generate_series(0, :projects - 1) as i;

insert into public.projects (id, key, name, client_org_id, lead_id, start_date, target_date, methodology,
                             contract_type, description, status, restricted, rag, estimate_unit, template_id,
                             next_item_number, created_at)
select id, key,
       case when ix = 0 then 'Load test — 20k item board' else 'Load programme ' || ix end,
       case when ix % 2 = 0 then 'a0000000-0000-4000-8000-000000000002'::uuid
            else 'a0000000-0000-4000-8000-000000000003'::uuid end,
       case when ix % 2 = 0 then 'b0000000-0000-4000-8000-000000000002'::uuid
            else 'b0000000-0000-4000-8000-000000000001'::uuid end,
       start_date, start_date + 180 + (ix * 37) % 120,
       (array['hybrid', 'scrum', 'kanban', 'waterfall'])[1 + ix % 4]::public.methodology,
       (array['fixed_fee', 'time_materials', 'retainer'])[1 + ix % 3]::public.contract_type,
       'Generated load-test project ' || key || '.', 'active', false,
       (array['green', 'green', 'green', 'amber', 'red'])[1 + ix % 5]::public.rag,
       'points', 'kdf-hybrid', n_items + 1, start_date::timestamptz
from _lp;

insert into public.project_financials (project_id, bac)
select id, 50000 + (ix * 7919) % 950 * 1000 from _lp;

insert into public.project_members (project_id, user_id, project_role, allocation_pct)
select p.id, m.uid, m.role, 10
from _lp p
cross join (values ('b0000000-0000-4000-8000-000000000002'::uuid, 'Delivery Lead'),
                   ('b0000000-0000-4000-8000-000000000003'::uuid, 'QA'),
                   ('b0000000-0000-4000-8000-000000000004'::uuid, 'Engineer')) as m(uid, role);

insert into public.phases (id, project_id, gate, name, status)
select md5('load-phase-' || p.ix || '-' || g)::uuid, p.id, g,
       (array['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'])[g],
       case when g < 3 then 'approved' when g = 3 then 'active' else 'not_started' end::public.phase_status
from _lp p cross join generate_series(1, 5) as g;

insert into public.gate_criteria (project_id, phase_id, text, done, position)
select p.id, md5('load-phase-' || p.ix || '-' || g)::uuid,
       (array['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'])[g] || ' exit criteria met', g < 3, 1
from _lp p cross join generate_series(1, 5) as g;

insert into public.sprints (id, project_id, phase_id, name, start_date, end_date, goal, status, capacity_hours)
select md5('load-sprint-' || p.ix || '-' || s)::uuid, p.id, md5('load-phase-' || p.ix || '-3')::uuid,
       p.key || ' Sprint ' || s, p.start_date + 30 + (s - 1) * 14, p.start_date + 41 + (s - 1) * 14,
       'Increment ' || s,
       case when s < 5 then 'completed' when s = 5 then 'active' else 'planned' end::public.sprint_status, 200
from _lp p cross join generate_series(1, 6) as s;

-- Work items. Status weights 40/15/10/7/5/15/8 and type weights 1/4/55/25/15 (as seed-load.ts),
-- taken from multiplicative hashes of the item number so they spread evenly.
insert into public.work_items (id, project_id, number, key, type, title, description, status, priority,
                               assignee_id, reporter_id, phase_id, sprint_id, parent_id, estimate, due_date,
                               labels, visibility, position, created_at, updated_at)
select md5('load-item-' || p.ix || '-' || n)::uuid, p.id, n, p.key || '-' || n,
       t.type, t.title, '<p>' || t.title || '. Generated for load testing (' || t.area || ' workstream).</p>',
       t.status, t.priority, t.assignee, 'b0000000-0000-4000-8000-000000000002'::uuid,
       md5('load-phase-' || p.ix || '-3')::uuid,
       case when t.type in ('epic', 'feature') or t.status = 'backlog' then null
            else md5('load-sprint-' || p.ix || '-' || (1 + n % 6))::uuid end,
       case when t.type <> 'epic' and n > 3 and n % 5 < 3 then md5('load-item-' || p.ix || '-' || (1 + n % 3))::uuid end,
       case when t.type = 'epic' then null else (array[1, 2, 3, 5, 8, 13])[1 + n % 6] end,
       case when n % 5 = 0 then p.start_date + 30 + n % 150 end,
       case when n % 2 = 0 then array[t.area] else '{}'::text[] end,
       case when (n * 31) % 10 < 7 then 'shared' else 'internal' end::public.visibility,
       n * 1000, p.start_date::timestamptz, p.start_date::timestamptz + ((n * 13) % 90) * interval '1 day'
from _lp p
cross join lateral generate_series(1, p.n_items) as n
cross join lateral (
  select
    case when n <= 3 then 'epic'
         else case when h.ty < 1 then 'epic' when h.ty < 5 then 'feature' when h.ty < 60 then 'story'
                   when h.ty < 85 then 'task' else 'bug' end end::public.item_type as type,
    case when n <= 3 then 'in_progress'
         else case when h.st < 40 then 'backlog' when h.st < 55 then 'ready' when h.st < 65 then 'in_progress'
                   when h.st < 72 then 'in_review' when h.st < 77 then 'client_review' when h.st < 92 then 'done'
                   else 'accepted' end end::public.item_status as status,
    case when h.pr < 5 then 'critical' when h.pr < 25 then 'high' when h.pr < 75 then 'medium'
         else 'low' end::public.priority as priority,
    case when h.pr % 7 = 0 then null
         else (array['b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003',
                     'b0000000-0000-4000-8000-000000000002'])[1 + n % 3]::uuid end as assignee,
    (array['Migrate', 'Validate', 'Configure', 'Build', 'Test', 'Reconcile', 'Document', 'Automate'])[1 + (n * 7) % 8]
      || ' ' || (array['appointment feed', 'billing export', 'patient portal login', 'lab results interface',
                       'pharmacy order sync', 'permit intake form', 'inspection calendar', 'audit trail report',
                       'role-based access', 'data conversion script', 'cutover runbook', 'training material'])[1 + (n * 5) % 12]
      || ' for ' || h.area || ' #' || n as title,
    h.area
  from (select (n::bigint * 7919 + p.ix * 104729) % 100 as st,
               (n::bigint * 104729 + p.ix * 7919) % 100 as ty,
               (n::bigint * 15485863 + p.ix) % 100 as pr,
               (array['clinic', 'county', 'finance', 'records', 'scheduling', 'reporting', 'integration'])[1 + (n * 3 + p.ix) % 7] as area) as h
) as t;

insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility, created_at)
select p.id, 'work_item', md5('load-item-' || p.ix || '-' || n)::uuid,
       (array['b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000003',
              'b0000000-0000-4000-8000-000000000002'])[1 + n % 3]::uuid,
       (array['Reviewed with the client; acceptance criteria look complete.',
              'Blocked on vendor credentials, chasing today.',
              'Dry-run passed for the sample set, running the full set next.',
              'Can we split this into two stories before sprint planning?',
              'Internal: estimate looks light, flag it at stand-up.',
              'Demo went well. Waiting on sign-off from the clinical lead.'])[1 + (n / 4) % 6],
       case when (n / 4) % 5 < 2 then 'internal' else 'shared' end::public.visibility,
       p.start_date::timestamptz + ((n * 13) % 90) * interval '1 day'
from _lp p cross join lateral generate_series(4, p.n_items, 4) as n;

insert into public.raid_entries (project_id, kind, title, description, category, owner_id, probability, impact,
                                 escalate, roam, mitigation, visibility, status, closure_note, closed_at,
                                 created_by, created_at, updated_at, severity)
select p.id, k.kind, k.title || ' (' || p.key || '-' || r || ')', 'Generated RAID entry for load testing.',
       case when k.kind = 'risk' then (array['schedule', 'cost', 'resource', 'technical', 'vendor'])[1 + r % 5] end,
       'b0000000-0000-4000-8000-000000000004'::uuid, k.p, k.i, k.p * k.i >= 15,
       case when k.kind = 'risk' then 'owned'::public.roam end,
       case when k.kind = 'risk' then 'Tracked at the weekly risk review.' end,
       case when r % 2 = 0 then 'shared' else 'internal' end::public.visibility,
       case when r % 5 = 0 then 'closed' else 'open' end::public.raid_status,
       case when r % 5 = 0 then 'Closed after review.' end,
       case when r % 5 = 0 then p.start_date::timestamptz + interval '20 days' end,
       'b0000000-0000-4000-8000-000000000002'::uuid,
       p.start_date::timestamptz + (r % 60) * interval '1 day',
       p.start_date::timestamptz + (r % 60 + r % 10) * interval '1 day',
       case when k.kind = 'issue' then (array['critical', 'major', 'minor'])[1 + r % 3]::public.issue_severity end
from _lp p
cross join generate_series(1, 30) as r
cross join lateral (
  select (array['risk', 'risk', 'risk', 'risk', 'risk', 'issue', 'issue', 'assumption', 'dependency', 'decision'])[1 + (r * 7) % 10]::public.raid_kind as kind,
         (array['Vendor interface delivered late', 'Key SME unavailable during UAT',
                'Data quality issues in legacy export', 'Budget pressure from change requests',
                'Regulatory review adds a review cycle'])[1 + r % 5] as title,
         1 + (r * 3) % 5 as p, 1 + (r * 7) % 5 as i
) as k;

commit;

analyze public.projects;
analyze public.work_items;
analyze public.comments;
analyze public.raid_entries;

select (select count(*) from public.projects) as projects,
       (select count(*) from public.work_items) as work_items,
       (select count(*) from public.work_items w join public.projects p on p.id = w.project_id
         where p.key = 'LOAD') as load_project_items,
       (select count(*) from public.comments) as comments,
       (select count(*) from public.raid_entries) as raid_entries;
