-- Demo data mirroring lib/data/seed.ts. Runs as the database owner (bypasses RLS).
-- Fixed UUIDs (the app can map the legacy seed ids to these):
--   orgs      a0000000-0000-4000-8000-00000000000{1 konnector, 2 peachtree, 3 riverbend}
--   profiles  b0000000-0000-4000-8000-0000000000{01 admin, 02 lead, 03 team, 04 dev, 05 assoc,
--                                                06 sponsor, 07 cmember, 08 cviewer, 09 rsponsor}
--   projects  c0000000-0000-4000-8000-00000000000{1 EHR, 2 RVB, 3 PSR}
--   everything else: md5('<legacy seed id>')::uuid, e.g. md5('wi_ehr_7')::uuid

begin;

-- Seeded items include an 'accepted' one; allow it for this owner-run transaction only.
set local konnect.allow_accept = 'on';

create temp table _u (legacy text primary key, id uuid not null) on commit drop;
insert into _u values
  ('u_admin',    'b0000000-0000-4000-8000-000000000001'),
  ('u_lead',     'b0000000-0000-4000-8000-000000000002'),
  ('u_team',     'b0000000-0000-4000-8000-000000000003'),
  ('u_dev',      'b0000000-0000-4000-8000-000000000004'),
  ('u_assoc',    'b0000000-0000-4000-8000-000000000005'),
  ('u_sponsor',  'b0000000-0000-4000-8000-000000000006'),
  ('u_cmember',  'b0000000-0000-4000-8000-000000000007'),
  ('u_cviewer',  'b0000000-0000-4000-8000-000000000008'),
  ('u_rsponsor', 'b0000000-0000-4000-8000-000000000009');

create temp table _p (legacy text primary key, id uuid not null, key text not null) on commit drop;
insert into _p values
  ('p_ehr', 'c0000000-0000-4000-8000-000000000001', 'EHR'),
  ('p_rvb', 'c0000000-0000-4000-8000-000000000002', 'RVB'),
  ('p_psr', 'c0000000-0000-4000-8000-000000000003', 'PSR');

-- Organizations ---------------------------------------------------------------
insert into public.organizations (id, name, type) values
  ('a0000000-0000-4000-8000-000000000001', 'Konnector LLC', 'internal'),
  ('a0000000-0000-4000-8000-000000000002', 'Peachtree Clinic Group', 'client'),
  ('a0000000-0000-4000-8000-000000000003', 'Riverbend County IT', 'client');

-- Users / profiles ------------------------------------------------------------
create temp table _prof (legacy text, org text, name text, email text, role public.user_role,
  mfa boolean, us boolean, title text, rate numeric, hours numeric, skills text[], tz text) on commit drop;
insert into _prof values
  ('u_admin', '1', 'Ada Okafor', 'ada@konnectortech.com', 'admin', true, true, 'Delivery Director', 120, 40, '{Governance,PMP}', 'America/New_York'),
  ('u_lead', '1', 'Lara Bennett', 'lara@konnectortech.com', 'delivery_lead', true, true, 'Delivery Lead', 105, 40, '{SAFe,EHR}', 'America/New_York'),
  ('u_team', '1', 'Tiara Mensah', 'tiara@konnectortech.com', 'team_member', true, true, 'QA Engineer', 80, 40, '{QA,Playwright}', 'America/Chicago'),
  ('u_dev', '1', 'Adeoba Cole', 'adeoba@konnectortech.com', 'team_member', true, true, 'Full-stack Engineer', 95, 40, '{TypeScript,Postgres}', 'America/New_York'),
  ('u_assoc', '1', 'Sam Rivera', 'sam@associates.konnectortech.com', 'associate', true, false, 'Integration Associate', 70, 30, '{HL7,FHIR}', 'Europe/London'),
  ('u_sponsor', '2', 'Grace Whitfield', 'grace@peachtreeclinic.example', 'client_sponsor', false, true, 'COO', null, null, '{}', null),
  ('u_cmember', '2', 'Mo Haddad', 'mo@peachtreeclinic.example', 'client_member', false, true, 'Clinical Lead', null, null, '{}', null),
  ('u_cviewer', '2', 'Vi Tran', 'vi@peachtreeclinic.example', 'client_viewer', false, true, 'Board Observer', null, null, '{}', null),
  ('u_rsponsor', '3', 'Ola Adeyemi', 'ola@riverbend.example', 'client_sponsor', false, true, 'CIO', null, null, '{}', null);

insert into auth.users (id, email)
select u.id, p.email from _prof p join _u u using (legacy);

insert into public.profiles (id, org_id, name, email, role, mfa_enabled, us_person, title, skills, timezone, hours_per_week)
select u.id, ('a0000000-0000-4000-8000-00000000000' || p.org)::uuid, p.name, p.email, p.role, p.mfa, p.us,
       p.title, p.skills, p.tz, p.hours
from _prof p join _u u using (legacy);

insert into public.profile_rates (profile_id, cost_rate)
select u.id, p.rate from _prof p join _u u using (legacy) where p.rate is not null;

insert into public.notification_prefs (user_id) select id from _u;

-- Projects --------------------------------------------------------------------
insert into public.projects (id, key, name, client_org_id, lead_id, start_date, target_date, methodology,
  contract_type, description, status, restricted, rag, rag_reason, estimate_unit, template_id,
  next_item_number, created_at) values
  ('c0000000-0000-4000-8000-000000000001', 'EHR', 'Demo — Clinic EHR Go-Live', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002', '2026-08-03', '2027-01-29', 'hybrid', 'fixed_fee',
   'Migrate Peachtree Clinic Group to a new EHR and support go-live across four clinics.', 'active', false,
   'amber', 'Conversion dry-run found duplicate patient records.', 'points', 'kdf-hybrid', 25, '2026-08-03T09:00:00Z'),
  ('c0000000-0000-4000-8000-000000000002', 'RVB', 'Riverbend Permit Portal', 'a0000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-000000000002', '2026-09-14', '2027-04-30', 'scrum', 'time_materials',
   'Online building-permit applications and inspections scheduling for Riverbend County.', 'active', true,
   'green', null, 'points', 'kdf-hybrid', 4, '2026-09-14T09:00:00Z'),
  ('c0000000-0000-4000-8000-000000000003', 'PSR', 'Peachtree Support Retainer', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-06-01', '2027-05-31', 'kanban', 'retainer',
   'Monthly support retainer for Peachtree’s practice-management system.', 'active', false,
   'green', null, 'hours', 'kanban-retainer', 3, '2026-06-01T09:00:00Z');

insert into public.project_financials (project_id, bac) values
  ('c0000000-0000-4000-8000-000000000001', 480000),
  ('c0000000-0000-4000-8000-000000000002', 310000),
  ('c0000000-0000-4000-8000-000000000003', 96000);

insert into public.project_members (project_id, user_id, project_role, allocation_pct)
select p.id, u.id, m.role, m.pct
from (values
  ('p_ehr', 'u_lead', 'Delivery Lead', 60), ('p_ehr', 'u_dev', 'Engineer', 80),
  ('p_ehr', 'u_team', 'QA', 50), ('p_ehr', 'u_assoc', 'Integration', 100),
  ('p_rvb', 'u_lead', 'Delivery Lead', 40), ('p_rvb', 'u_dev', 'Engineer', 20),
  ('p_psr', 'u_team', 'Support', 30)
) m(proj, usr, role, pct)
join _p p on p.legacy = m.proj join _u u on u.legacy = m.usr;

-- Phases + gate criteria (buildPhases: earlier gates approved, active gate active) -------
create temp table _tpl (gate int, name text, criteria text[]) on commit drop;
insert into _tpl values
  (1, 'Mobilize', '{"Project charter approved","Acceptance criteria approved"}'),
  (2, 'Plan', '{"Baseline schedule approved","Baseline budget approved"}'),
  (3, 'Execute', '{"Each increment demonstrated and accepted"}'),
  (4, 'Accept', '{"UAT passed","Go-live readiness signed"}'),
  (5, 'Transition', '{"Stabilization targets met","Handover signed"}');

create temp table _active (legacy text, active int, tpl text) on commit drop;
insert into _active values ('p_ehr', 3, 'kdf-hybrid'), ('p_rvb', 2, 'kdf-hybrid'), ('p_psr', 3, 'kanban-retainer');

insert into public.phases (id, project_id, gate, name, status)
select md5(a.legacy || '_ph' || t.gate)::uuid, p.id, t.gate, t.name,
       case when t.gate < a.active then 'approved' when t.gate = a.active then 'active' else 'not_started' end::public.phase_status
from _active a join _p p using (legacy) cross join _tpl t;

insert into public.gate_criteria (id, project_id, phase_id, text, position, done, done_by, done_at)
select md5(a.legacy || '_ph' || t.gate || '_c' || (c.ord - 1))::uuid, p.id, md5(a.legacy || '_ph' || t.gate)::uuid,
       case when t.gate = 3 and a.tpl = 'kanban-retainer' then 'Monthly service review accepted' else c.txt end,
       c.ord, t.gate < a.active,
       case when t.gate < a.active then 'b0000000-0000-4000-8000-000000000002'::uuid end,
       case when t.gate < a.active then '2026-08-03T09:00:00Z'::timestamptz end
from _active a join _p p using (legacy) cross join _tpl t
cross join lateral unnest(case when t.gate = 3 and a.tpl = 'kanban-retainer' then array['x'] else t.criteria end)
  with ordinality c(txt, ord);

-- Gate decisions recorded by each client sponsor for approved gates.
insert into public.gate_reviews (id, project_id, phase_id, decision, reason, decided_by, decided_at, ip) values
  (md5('gr_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph1')::uuid, 'approved', null,
   'b0000000-0000-4000-8000-000000000006', '2026-08-21T16:00:00Z', '203.0.113.10'),
  (md5('gr_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph2')::uuid, 'approved', null,
   'b0000000-0000-4000-8000-000000000006', '2026-09-18T16:00:00Z', '203.0.113.10'),
  (md5('gr_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('p_rvb_ph1')::uuid, 'approved', null,
   'b0000000-0000-4000-8000-000000000009', '2026-09-30T16:00:00Z', '198.51.100.7');

-- Sprints ---------------------------------------------------------------------
insert into public.sprints (id, project_id, phase_id, name, start_date, end_date, goal, status, capacity_hours) values
  (md5('s_ehr1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph3')::uuid, 'EHR Sprint 1', '2026-09-21', '2026-10-02', 'Appointment mapping complete', 'completed', 220),
  (md5('s_ehr2')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph3')::uuid, 'EHR Sprint 2', '2026-10-05', '2026-10-16', 'Conversion dry-run and first templates', 'active', 220),
  (md5('s_ehr3')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph3')::uuid, 'EHR Sprint 3', '2026-10-19', '2026-10-30', 'Reconcile and train', 'planned', 200),
  (md5('s_rvb1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('p_rvb_ph2')::uuid, 'RVB Sprint 1', '2026-10-05', '2026-10-16', 'Intake prototype', 'active', 120);

-- Work items: EHR ---------------------------------------------------------------
create temp table _ehr (n int, type public.item_type, title text, status public.item_status,
  priority public.priority, assignee text, estimate numeric, vis public.visibility, labels text[]) on commit drop;
insert into _ehr values
  (1, 'epic', 'Patient scheduling migration', 'in_progress', 'high', 'u_lead', null, 'shared', '{}'),
  (2, 'epic', 'Clinical documentation go-live', 'in_progress', 'high', 'u_lead', null, 'shared', '{}'),
  (3, 'epic', 'Integrations: labs and pharmacy', 'ready', 'medium', 'u_assoc', null, 'internal', '{}'),
  (4, 'feature', 'Appointment data conversion', 'in_progress', 'high', 'u_dev', 13, 'shared', '{}'),
  (5, 'feature', 'Provider template build', 'in_review', 'medium', 'u_dev', 8, 'shared', '{}'),
  (6, 'story', 'Map legacy appointment types to new visit types', 'done', 'high', 'u_dev', 5, 'shared', '{data}'),
  (7, 'story', 'Dry-run conversion of 12 months of appointments', 'in_progress', 'critical', 'u_dev', 8, 'shared', '{data,cutover}'),
  (8, 'story', 'Reconcile converted appointments against source report', 'ready', 'high', 'u_team', 5, 'shared', '{data}'),
  (9, 'story', 'Build family-medicine progress note template', 'client_review', 'medium', 'u_dev', 3, 'shared', '{templates}'),
  (10, 'story', 'Build pediatrics well-child template', 'in_review', 'medium', 'u_dev', 3, 'shared', '{templates}'),
  (11, 'story', 'Train super-users on documentation workflow', 'backlog', 'medium', 'u_lead', 5, 'shared', '{training}'),
  (12, 'task', 'Confirm HL7 ADT feed endpoint with lab vendor', 'in_progress', 'high', 'u_assoc', 2, 'internal', '{vendor}'),
  (13, 'task', 'Pharmacy e-prescribing certification paperwork', 'ready', 'medium', 'u_assoc', 3, 'internal', '{vendor}'),
  (14, 'task', 'Set up UAT environment refresh schedule', 'done', 'medium', 'u_team', 2, 'internal', '{}'),
  (15, 'task', 'Write cutover runbook draft', 'backlog', 'high', 'u_lead', 5, 'internal', '{cutover}'),
  (16, 'bug', 'Duplicate patients created when MRN has leading zeros', 'in_progress', 'critical', 'u_dev', 3, 'shared', '{data}'),
  (17, 'bug', 'Template signature block missing credentials', 'ready', 'low', 'u_dev', 1, 'shared', '{templates}'),
  (18, 'bug', 'Converted recurring appointments lose end date', 'backlog', 'high', null, 2, 'internal', '{data}'),
  (19, 'change_request', 'Add telehealth visit type to conversion scope', 'backlog', 'medium', 'u_lead', 5, 'shared', '{}'),
  (20, 'client_request', 'Can we keep the old fax cover sheet layout?', 'backlog', 'low', null, null, 'shared', '{}'),
  (21, 'story', 'Load provider schedules for first 30 days', 'ready', 'high', 'u_team', 3, 'shared', '{cutover}'),
  (22, 'story', 'Accept go-live readiness checklist', 'backlog', 'high', 'u_lead', 2, 'shared', '{cutover}'),
  (23, 'task', 'Internal estimate review for integration effort', 'done', 'low', 'u_lead', 1, 'internal', '{}'),
  (24, 'story', 'Clinic front-desk check-in workflow walkthrough', 'accepted', 'medium', 'u_team', 3, 'shared', '{training}');

insert into public.work_items (id, project_id, number, key, type, title, description, status, priority,
  assignee_id, reporter_id, phase_id, sprint_id, parent_id, estimate, due_date, labels, visibility,
  position, created_at, updated_at)
select md5('wi_ehr_' || e.n)::uuid, 'c0000000-0000-4000-8000-000000000001', e.n, 'EHR-' || e.n, e.type, e.title,
  case when e.type = 'epic' then '<p>' || e.title || ' across all four clinics.</p>' else '<p>' || e.title || '.</p>' end,
  e.status, e.priority, u.id, 'b0000000-0000-4000-8000-000000000002', md5('p_ehr_ph3')::uuid,
  case when e.type in ('epic', 'feature') then null
       when e.status in ('done', 'accepted') then md5('s_ehr1')::uuid
       when e.status in ('in_progress', 'in_review', 'client_review') then md5('s_ehr2')::uuid
       when e.status = 'ready' then md5('s_ehr3')::uuid end,
  case when e.type = 'feature' then md5(case when e.n = 4 then 'wi_ehr_1' else 'wi_ehr_2' end)::uuid
       when e.type = 'story' and 'data' = any(e.labels) then md5('wi_ehr_4')::uuid
       when e.type = 'story' and 'templates' = any(e.labels) then md5('wi_ehr_5')::uuid end,
  e.estimate, case when e.n % 4 = 0 then '2026-10-30'::date end, e.labels, e.vis, e.n * 1000,
  '2026-08-03T09:00:00Z', '2026-08-03T09:00:00Z'
from _ehr e left join _u u on u.legacy = e.assignee
order by e.n;

insert into public.acceptance_criteria (id, project_id, item_id, text, status, position)
select md5('ac_' || e.n || '_' || x.i)::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_' || e.n)::uuid,
       x.txt, case when e.status = 'accepted' then 'accepted' else 'pending' end::public.ac_status, x.i
from _ehr e cross join (values (1, 'Demonstrated to the clinical lead'), (2, 'No open critical defects')) x(i, txt)
where e.type = 'story';

-- Work items: RVB + PSR -----------------------------------------------------------
insert into public.work_items (id, project_id, number, key, type, title, description, status, priority,
  assignee_id, reporter_id, phase_id, estimate, labels, visibility, position, created_at, updated_at)
select md5(x.legacy)::uuid, p.id, x.n, p.key || '-' || x.n, x.type::public.item_type, x.title, '<p>' || x.title || '.</p>',
       x.status::public.item_status, 'medium', 'b0000000-0000-4000-8000-000000000004',
       'b0000000-0000-4000-8000-000000000002', md5(p.legacy || '_ph' || x.gate)::uuid, 3, '{}',
       x.vis::public.visibility, x.n * 1000, '2026-08-03T09:00:00Z', '2026-08-03T09:00:00Z'
from (values
  ('wi_rvb_1', 'p_rvb', 1, 'epic', 'Permit application intake', 'backlog', 'shared', 2),
  ('wi_rvb_2', 'p_rvb', 2, 'story', 'Applicant can upload site plans', 'ready', 'shared', 2),
  ('wi_rvb_3', 'p_rvb', 3, 'task', 'Security baseline for county network', 'in_progress', 'internal', 2),
  ('wi_psr_1', 'p_psr', 1, 'bug', 'Claims export fails on month end', 'in_progress', 'shared', 3),
  ('wi_psr_2', 'p_psr', 2, 'task', 'Quarterly patch window planning', 'backlog', 'internal', 3)
) x(legacy, proj, n, type, title, status, vis, gate)
join _p p on p.legacy = x.proj;

insert into public.acceptance_criteria (id, project_id, item_id, text, position) values
  (md5('ac_rvb_2_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('wi_rvb_2')::uuid, 'PDF and DWG uploads accepted up to 50 MB', 1);

-- Links -------------------------------------------------------------------------
insert into public.item_links (id, project_id, from_id, to_id, type) values
  (md5('ln_1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_16')::uuid, md5('wi_ehr_7')::uuid, 'blocks'),
  (md5('ln_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('wi_rvb_3')::uuid, md5('wi_rvb_2')::uuid, 'blocks');

-- Comments ----------------------------------------------------------------------
insert into public.comments (id, project_id, entity_type, entity_id, author_id, body, visibility, mentions, created_at) values
  (md5('cm_1')::uuid, 'c0000000-0000-4000-8000-000000000001', 'work_item', md5('wi_ehr_7')::uuid, 'b0000000-0000-4000-8000-000000000004',
   'Dry-run is 70% through. Seeing duplicates on MRNs with leading zeros, logged as EHR-16.', 'shared', '{}', '2026-10-08T14:00:00Z'),
  (md5('cm_2')::uuid, 'c0000000-0000-4000-8000-000000000001', 'work_item', md5('wi_ehr_7')::uuid, 'b0000000-0000-4000-8000-000000000002',
   'Internal: we may need two extra days; hold off telling the client until Thursday’s re-run.', 'internal',
   '{b0000000-0000-4000-8000-000000000004}', '2026-10-08T15:10:00Z'),
  (md5('cm_3')::uuid, 'c0000000-0000-4000-8000-000000000001', 'work_item', md5('wi_ehr_9')::uuid, 'b0000000-0000-4000-8000-000000000007',
   'Template looks good. Can the plan section default to expanded?', 'shared', '{}', '2026-10-09T10:00:00Z'),
  (md5('cm_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', 'work_item', md5('wi_rvb_2')::uuid, 'b0000000-0000-4000-8000-000000000009',
   'Inspectors also need to see the uploaded plans.', 'shared', '{}', '2026-10-09T11:00:00Z'),
  (md5('cm_rvb_2')::uuid, 'c0000000-0000-4000-8000-000000000002', 'work_item', md5('wi_rvb_3')::uuid, 'b0000000-0000-4000-8000-000000000004',
   'County firewall rules still pending.', 'internal', '{}', '2026-10-09T12:00:00Z');

-- Attachments -------------------------------------------------------------------
insert into public.attachments (id, project_id, entity_type, entity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, visibility) values
  (md5('at_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', 'work_item', md5('wi_ehr_9')::uuid, 'progress-note-v2.pdf',
   'p_ehr/wi_ehr_9/progress-note-v2.pdf', 'application/pdf', 182000, 'b0000000-0000-4000-8000-000000000004', 'shared'),
  (md5('at_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', 'work_item', md5('wi_ehr_12')::uuid, 'lab-vendor-contacts.xlsx',
   'p_ehr/wi_ehr_12/lab-vendor-contacts.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 9000,
   'b0000000-0000-4000-8000-000000000005', 'internal'),
  (md5('at_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', 'work_item', md5('wi_rvb_2')::uuid, 'sample-site-plan.pdf',
   'p_rvb/wi_rvb_2/sample-site-plan.pdf', 'application/pdf', 450000, 'b0000000-0000-4000-8000-000000000009', 'shared');

-- Deliverables ------------------------------------------------------------------
insert into public.deliverables (id, project_id, phase_id, name, description, status, due_date, visibility) values
  (md5('dl_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('p_ehr_ph3')::uuid, 'Increment 1: appointment conversion',
   'Converted appointment data and reconciliation report.', 'submitted', '2026-10-30', 'shared'),
  (md5('dl_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('p_rvb_ph2')::uuid, 'Permit portal prototype',
   'Clickable intake prototype.', 'draft', '2026-11-13', 'shared');
insert into public.deliverable_items (project_id, deliverable_id, item_id) values
  ('c0000000-0000-4000-8000-000000000001', md5('dl_ehr_1')::uuid, md5('wi_ehr_6')::uuid),
  ('c0000000-0000-4000-8000-000000000001', md5('dl_ehr_1')::uuid, md5('wi_ehr_7')::uuid),
  ('c0000000-0000-4000-8000-000000000001', md5('dl_ehr_1')::uuid, md5('wi_ehr_18')::uuid),
  ('c0000000-0000-4000-8000-000000000002', md5('dl_rvb_1')::uuid, md5('wi_rvb_2')::uuid);

-- RAID --------------------------------------------------------------------------
insert into public.raid_entries (id, project_id, kind, title, description, category, owner_id, probability, impact,
  roam, mitigation, sla_due, visibility, status, created_by) values
  (md5('rd_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', 'risk', 'Duplicate patient records delay cutover',
   'Leading-zero MRNs create duplicates in the dry-run.', 'Technical', 'b0000000-0000-4000-8000-000000000004', 4, 4,
   'owned', 'Normalise MRNs before load; re-run dry-run.', '2026-10-16', 'shared', 'open', 'b0000000-0000-4000-8000-000000000002'),
  (md5('rd_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', 'risk', 'Integration estimate may be low',
   'Lab and pharmacy vendor effort could exceed the fixed fee.', 'Cost', 'b0000000-0000-4000-8000-000000000002', 3, 4,
   'owned', 'Review estimate with associate before next gate.', '2026-10-23', 'internal', 'open', 'b0000000-0000-4000-8000-000000000002'),
  (md5('rd_ehr_3')::uuid, 'c0000000-0000-4000-8000-000000000001', 'dependency', 'Lab vendor ADT endpoint',
   'Vendor must provide the production ADT endpoint.', 'Vendor', 'b0000000-0000-4000-8000-000000000005', 3, 3,
   null, null, '2026-10-20', 'shared', 'in_progress', 'b0000000-0000-4000-8000-000000000002'),
  (md5('rd_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', 'risk', 'County network change freeze',
   'Change freeze in November could block deployment.', 'Schedule', 'b0000000-0000-4000-8000-000000000002', 3, 5,
   'owned', 'Request exception early.', '2026-10-30', 'shared', 'open', 'b0000000-0000-4000-8000-000000000002'),
  (md5('rd_rvb_2')::uuid, 'c0000000-0000-4000-8000-000000000002', 'issue', 'Security review backlog at county',
   'Internal note on county security review queue.', 'Regulatory', 'b0000000-0000-4000-8000-000000000002', 2, 3,
   null, null, null, 'internal', 'open', 'b0000000-0000-4000-8000-000000000002');

-- RAID links (0003_raid_register). The EHR-12 link points at an internal item, so clients never see it.
insert into public.raid_links (project_id, raid_id, item_id) values
  ('c0000000-0000-4000-8000-000000000001', md5('rd_ehr_1')::uuid, md5('wi_ehr_7')::uuid),
  ('c0000000-0000-4000-8000-000000000001', md5('rd_ehr_1')::uuid, md5('wi_ehr_12')::uuid),
  ('c0000000-0000-4000-8000-000000000002', md5('rd_rvb_1')::uuid, md5('wi_rvb_2')::uuid);

-- Time, allocations, status reports -----------------------------------------------
-- Time lifecycle (0012_ledger.sql): one approved EHR entry feeds EVM actual cost; the submitted
-- and draft entries show that only approved time counts.
insert into public.time_entries (id, project_id, item_id, user_id, entry_date, hours, note, status, submitted_at, decided_by, decided_at) values
  (md5('te_1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_7')::uuid, 'b0000000-0000-4000-8000-000000000004', '2026-10-07', 6, 'Dry-run',
   'approved', '2026-10-09 17:00+00', 'b0000000-0000-4000-8000-000000000002', '2026-10-10 09:00+00'),
  (md5('te_2')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_12')::uuid, 'b0000000-0000-4000-8000-000000000005', '2026-10-07', 3, 'Vendor call',
   'submitted', '2026-10-09 17:00+00', null, null),
  (md5('te_3')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('wi_rvb_3')::uuid, 'b0000000-0000-4000-8000-000000000004', '2026-10-07', 2, 'Baseline',
   'draft', null, null, null);

-- Weekly allocations (0011_capacity.sql; mirrors lib/data/seed-capacity.ts): every member's
-- hours per week × allocation % for the next 12 ISO weeks within the project window, plus the
-- cutover spike (u_dev 40 h on EHR in the third week = 120% with RVB).
insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours)
select m.project_id, m.user_id, w::date, w::date + 6, 0,
       case when m.user_id = 'b0000000-0000-4000-8000-000000000004' and m.project_id = 'c0000000-0000-4000-8000-000000000001'
                 and w::date = date_trunc('week', current_date)::date + 14 then 40
            else round(coalesce(nullif(u.hours_per_week, 0), 40) * m.allocation_pct) / 100 end
from public.project_members m
join public.profiles u on u.id = m.user_id
join public.projects p on p.id = m.project_id,
generate_series(date_trunc('week', current_date), date_trunc('week', current_date) + interval '11 weeks', interval '7 days') w
where m.allocation_pct > 0
  and w::date >= date_trunc('week', p.start_date)::date
  and w::date <= date_trunc('week', p.target_date)::date;

-- Directory certifications and locations (0011_capacity.sql; mirrors SEED_EXTRAS).
update public.profiles u set certifications = x.certs, location = x.loc
from (values
  ('u_admin', '{PMP,"SAFe SPC"}'::text[], 'Atlanta, GA'),
  ('u_lead', '{PMP,CSM}'::text[], 'Atlanta, GA'),
  ('u_team', '{"ISTQB Foundation"}'::text[], 'Chicago, IL'),
  ('u_dev', '{"AWS Developer Associate"}'::text[], 'Raleigh, NC'),
  ('u_assoc', '{"HL7 FHIR R4"}'::text[], 'London, UK')
) x(legacy, certs, loc)
join _u on _u.legacy = x.legacy
where u.id = _u.id;

insert into public.status_reports (id, project_id, period_start, period_end, rag, summary, visibility, author_id, published_at) values
  (md5('sr_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', '2026-09-28', '2026-10-02', 'amber',
   'Mapping complete; dry-run found duplicate MRNs.', 'shared', 'b0000000-0000-4000-8000-000000000002', '2026-10-02T17:00:00Z'),
  (md5('sr_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', '2026-10-05', '2026-10-09', 'amber',
   'Draft: two-day slip likely.', 'internal', 'b0000000-0000-4000-8000-000000000002', null),
  (md5('sr_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', '2026-10-05', '2026-10-09', 'green',
   'Intake prototype on track.', 'shared', 'b0000000-0000-4000-8000-000000000002', '2026-10-09T17:00:00Z');

-- Notifications -----------------------------------------------------------------
insert into public.notifications (id, user_id, project_id, kind, title, body) values
  (md5('nt_1')::uuid, 'b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'client_review',
   'EHR-9 is ready for your review', 'Build family-medicine progress note template'),
  (md5('nt_2')::uuid, 'b0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000002', 'status_report',
   'New status report for RVB', 'Intake prototype on track.'),
  (md5('nt_3')::uuid, 'b0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'mention',
   'Lara mentioned you on EHR-7', 'Internal: we may need two extra days');

-- Activity ----------------------------------------------------------------------
insert into public.activity (id, project_id, item_id, actor_id, action, detail, visibility, at) values
  (md5('ac_1')::uuid, 'c0000000-0000-4000-8000-000000000001', null, 'b0000000-0000-4000-8000-000000000002', 'gate.approved',
   'Plan gate approved by Grace Whitfield', 'shared', '2026-09-18T16:00:00Z'),
  (md5('ac_2')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_6')::uuid, 'b0000000-0000-4000-8000-000000000004', 'item.status',
   'EHR-6 moved to Done', 'shared', '2026-10-01T12:00:00Z'),
  (md5('ac_3')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('wi_ehr_24')::uuid, 'b0000000-0000-4000-8000-000000000006', 'item.accepted',
   'EHR-24 accepted by Grace Whitfield', 'shared', '2026-10-02T09:30:00Z'),
  (md5('ac_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('wi_rvb_3')::uuid, 'b0000000-0000-4000-8000-000000000004', 'item.status',
   'RVB-3 moved to In Progress', 'internal', '2026-10-06T12:00:00Z');

-- Audit -------------------------------------------------------------------------
insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after, at) values
  ('b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'project.create', 'project',
   'c0000000-0000-4000-8000-000000000002', '{"key":"RVB"}', '2026-09-14T09:00:00Z');

-- Gates and deliverables (0005_gates_deliverables.sql; mirrors lib/data/seed-gates.ts) -------
update public.gate_reviews set requested_by = 'b0000000-0000-4000-8000-000000000002',
  requested_at = decided_at - interval '2 days'
  where id in (md5('gr_ehr_1')::uuid, md5('gr_ehr_2')::uuid, md5('gr_rvb_1')::uuid);
insert into public.gate_review_budgets (review_id, project_id, bac, percent_complete) values
  (md5('gr_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', 480000, 0),
  (md5('gr_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', 480000, 0),
  (md5('gr_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', 310000, 0);
update public.deliverables set owner_id = 'b0000000-0000-4000-8000-000000000002',
  created_by = 'b0000000-0000-4000-8000-000000000002';
insert into public.deliverable_criteria (id, project_id, deliverable_id, text, position) values
  (md5('dlc_ehr_1_1')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('dl_ehr_1')::uuid,
   'All legacy appointment types map to a new visit type', 1),
  (md5('dlc_ehr_1_2')::uuid, 'c0000000-0000-4000-8000-000000000001', md5('dl_ehr_1')::uuid,
   'Reconciliation report shows under 0.5% variance from source', 2),
  (md5('dlc_rvb_1_1')::uuid, 'c0000000-0000-4000-8000-000000000002', md5('dl_rvb_1')::uuid,
   'Applicants can complete intake end to end', 1);

-- Pulse: status history and report working copies (0007_pulse.sql; mirrors lib/data/seed-pulse.ts) --
insert into public.status_history (project_id, item_id, from_status, to_status, changed_by, at) values
  ('c0000000-0000-4000-8000-000000000001', md5('wi_ehr_6')::uuid, 'in_review', 'done',
   'b0000000-0000-4000-8000-000000000004', '2026-10-01T15:00:00Z'),
  ('c0000000-0000-4000-8000-000000000001', md5('wi_ehr_7')::uuid, 'ready', 'in_progress',
   'b0000000-0000-4000-8000-000000000004', '2026-09-24T15:00:00Z'),
  ('c0000000-0000-4000-8000-000000000002', md5('wi_rvb_3')::uuid, 'ready', 'in_progress',
   'b0000000-0000-4000-8000-000000000004', '2026-10-06T12:00:00Z');
update public.status_reports set rag_reason = summary;
insert into public.status_report_drafts (report_id, project_id, sections) values
  (md5('sr_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', '{"scope": "<p>Mapping complete.</p>"}'),
  (md5('sr_ehr_2')::uuid, 'c0000000-0000-4000-8000-000000000001', '{"scope": "<p>Draft: two-day slip likely.</p>"}'),
  (md5('sr_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', '{"scope": "<p>Intake prototype on track.</p>"}');
insert into public.status_report_budgets (report_id, project_id, html) values
  (md5('sr_ehr_1')::uuid, 'c0000000-0000-4000-8000-000000000001', '<p>Budget at completion: $480,000 (fixed fee).</p>'),
  (md5('sr_rvb_1')::uuid, 'c0000000-0000-4000-8000-000000000002', '<p>Budget at completion: $310,000 (time and materials).</p>');

commit;
