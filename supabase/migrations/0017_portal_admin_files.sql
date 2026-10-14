-- Team Portal (PI-1 Sprint 5): Admin console (ADM-01, spec 3.11) and attachments (FILE-01, spec 4 Files).
-- Mirrors lib/domain/admin.ts, lib/domain/files.ts and lib/data/{admin,templates-admin,custom-fields,attachments}{,-postgres}.ts.
--
--   1. profiles: soft deactivation (a deactivated user has no role, so RLS gives them nothing),
--      role must match the org type, nobody changes their own role or deactivates themselves.
--   2. audit_log: every insert records the client IP the app passes in `kh.client_ip`.
--   3. invites: any role, with the org the person joins; re-send bookkeeping.
--   4. templates: the three built-ins plus Admin-made custom templates; create_project_from_template
--      now reads its gates and exit criteria from this table.
--   5. project_workflows: per-project status labels and WIP limits (Accepted is fixed).
--   6. custom_fields + custom_field_values: workspace fields shown on work items.
--   7. attachments: files on comments, the per-client bucket, the 25 MB limit and a type allow-list.

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles add column deactivated_at timestamptz;

-- A deactivated user has no role: every policy built on these helpers denies them.
create or replace function public.current_profile_role()
returns public.user_role language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and deactivated_at is null
$$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select org_id from public.profiles where id = auth.uid() and deactivated_at is null
$$;

create or replace function public.visible_project_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select id, org_id, role, us_person from public.profiles where id = auth.uid() and deactivated_at is null
  )
  select p.id
  from public.projects p, me
  where case
    when p.deleted_at is not null then me.role = 'admin'
    when me.role = 'admin' then true
    when me.role in ('client_sponsor', 'client_member', 'client_viewer') then p.client_org_id = me.org_id
    when p.restricted and not me.us_person then false
    when me.role = 'delivery_lead' and p.lead_id = me.id then true
    else exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = me.id)
  end
$$;

-- Konnector users hold Konnector roles, client users client roles; Admins can't lock themselves out.
create or replace function public.tg_profiles_admin_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type public.org_type;
begin
  select type into v_type from public.organizations where id = new.org_id;
  if (v_type = 'internal') is distinct from (new.role in ('admin', 'delivery_lead', 'team_member', 'associate')) then
    raise exception 'role % does not match the % organization', new.role, coalesce(v_type::text, 'unknown')
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    if new.deactivated_at is distinct from old.deactivated_at and not public.is_admin() then
      raise exception 'only an admin can deactivate users' using errcode = '42501';
    end if;
    if new.id = auth.uid() and (new.role is distinct from old.role
                                or new.deactivated_at is distinct from old.deactivated_at) then
      raise exception 'You cannot change your own role or deactivate yourself. Ask another Admin.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_admin_rules before insert or update on public.profiles
  for each row execute function public.tg_profiles_admin_rules();

-- Deactivation and reactivation are permission changes: audited like role changes (0012).
create or replace function public.tg_audit_profile_activation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.deactivated_at is distinct from old.deactivated_at then
    insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(),
            case when new.deactivated_at is null then 'user.reactivate' else 'user.deactivate' end,
            'profile', new.id::text,
            jsonb_build_object('deactivatedAt', old.deactivated_at),
            jsonb_build_object('deactivatedAt', new.deactivated_at));
  end if;
  return new;
end $$;

create trigger profiles_audit_activation after update of deactivated_at on public.profiles
  for each row execute function public.tg_audit_profile_activation();

-- ---------------------------------------------------------------------------
-- 2. Audit log: "from where". The app validates the IP and sets it for its transaction only.
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit_log_client_ip()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.ip is null then
    begin
      new.ip := nullif(current_setting('kh.client_ip', true), '')::inet;
    exception when others then
      new.ip := null;
    end;
  end if;
  return new;
end $$;

create trigger audit_log_client_ip before insert on public.audit_log
  for each row execute function public.tg_audit_log_client_ip();

-- ---------------------------------------------------------------------------
-- 3. Invites: any role, with an org (null = Konnector, as the wizard records them).
-- ---------------------------------------------------------------------------
alter table public.invites drop constraint invites_role_check;
alter table public.invites drop constraint invites_status_check;
alter table public.invites
  add column org_id uuid references public.organizations (id) on delete cascade,
  add column last_sent_at timestamptz,
  add column sent_count integer not null default 0 check (sent_count >= 0),
  add column auth_user_id uuid,
  add constraint invites_status_check check (status in ('pending', 'sent'));

create or replace function public.tg_invites_role_org()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type public.org_type := 'internal';
begin
  if new.org_id is not null then
    select type into v_type from public.organizations where id = new.org_id;
    if not found then raise exception 'organization not found' using errcode = '23503'; end if;
  end if;
  if (v_type = 'internal') is distinct from (new.role in ('admin', 'delivery_lead', 'team_member', 'associate')) then
    raise exception 'role % does not match the % organization', new.role, v_type using errcode = '23514';
  end if;
  return new;
end $$;

create trigger invites_role_org before insert or update on public.invites
  for each row execute function public.tg_invites_role_org();

-- Any Admin may re-send or revoke an invite another Admin created; inserts are attributed.
drop policy invites_admin on public.invites;
create policy invites_admin_read on public.invites for select to authenticated
  using ((select public.is_admin()));
create policy invites_admin_insert on public.invites for insert to authenticated
  with check ((select public.is_admin()) and invited_by = (select auth.uid()));
create policy invites_admin_update on public.invites for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy invites_admin_delete on public.invites for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 4. Project templates
-- ---------------------------------------------------------------------------
create table public.templates (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 500),
  base_id text references public.templates (id),
  builtin boolean not null default false,
  -- [{"gate": 1, "name": "Mobilize", "criteria": ["..."]}, ...] for gates 1..5
  phases jsonb not null check (jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) = 5),
  raid_categories text[] not null check (cardinality(raid_categories) between 1 and 15),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create or replace function public.tg_templates_check()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (
       select 1 from jsonb_array_elements(new.phases) e
       where jsonb_typeof(e -> 'criteria') is distinct from 'array'
          or jsonb_array_length(e -> 'criteria') not between 1 and 12
          or coalesce(e ->> 'gate', '') !~ '^[1-5]$'
          or e ->> 'name' is distinct from (array['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'])[(e ->> 'gate')::int])
     or (select count(distinct e ->> 'gate') from jsonb_array_elements(new.phases) e) <> 5 then
    raise exception 'A template needs the five gates, each with 1 to 12 exit criteria' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.phases) e, jsonb_array_elements_text(e -> 'criteria') c
             where char_length(btrim(c)) not between 2 and 200) then
    raise exception 'Exit criteria need 2 to 200 characters' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (old.builtin or new.builtin is distinct from old.builtin
                           or new.phases is distinct from old.phases
                           or new.raid_categories is distinct from old.raid_categories) then
    raise exception 'Templates cannot be edited once created; create a new one instead' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger templates_check before insert or update on public.templates
  for each row execute function public.tg_templates_check();

insert into public.templates (id, name, description, builtin, phases, raid_categories) values
  ('kdf-hybrid', 'Konnect Delivery Framework — Hybrid', 'Five gated phases with Agile sprints inside Execute.', true,
   '[{"gate": 1, "name": "Mobilize", "criteria": ["Project charter approved", "Acceptance criteria approved"]},
     {"gate": 2, "name": "Plan", "criteria": ["Baseline schedule approved", "Baseline budget approved"]},
     {"gate": 3, "name": "Execute", "criteria": ["Each increment demonstrated and accepted"]},
     {"gate": 4, "name": "Accept", "criteria": ["UAT passed", "Go-live readiness signed"]},
     {"gate": 5, "name": "Transition", "criteria": ["Stabilization targets met", "Handover signed"]}]',
   array['Schedule', 'Cost', 'Resource', 'Technical', 'Vendor', 'Regulatory', 'Reputational']),
  ('kanban-retainer', 'Kanban Support Retainer',
   'Continuous flow support with light gates for onboarding and handover.', true,
   '[{"gate": 1, "name": "Mobilize", "criteria": ["Project charter approved", "Acceptance criteria approved"]},
     {"gate": 2, "name": "Plan", "criteria": ["Baseline schedule approved", "Baseline budget approved"]},
     {"gate": 3, "name": "Execute", "criteria": ["Monthly service review accepted"]},
     {"gate": 4, "name": "Accept", "criteria": ["UAT passed", "Go-live readiness signed"]},
     {"gate": 5, "name": "Transition", "criteria": ["Stabilization targets met", "Handover signed"]}]',
   array['Schedule', 'Cost', 'Resource', 'Technical', 'Vendor', 'Regulatory', 'Reputational']),
  ('advisory', 'Advisory Engagement',
   'Discovery and recommendation work with client sign-off on each report.', true,
   '[{"gate": 1, "name": "Mobilize", "criteria": ["Project charter approved", "Acceptance criteria approved"]},
     {"gate": 2, "name": "Plan", "criteria": ["Baseline schedule approved", "Baseline budget approved"]},
     {"gate": 3, "name": "Execute", "criteria": ["Findings report accepted"]},
     {"gate": 4, "name": "Accept", "criteria": ["UAT passed", "Go-live readiness signed"]},
     {"gate": 5, "name": "Transition", "criteria": ["Stabilization targets met", "Handover signed"]}]',
   array['Schedule', 'Cost', 'Resource', 'Technical', 'Vendor', 'Regulatory', 'Reputational']);

alter table public.templates enable row level security;

-- Konnector staff read templates (the create-project dialog); Admins add and archive custom ones.
-- Built-ins are read-only; there is no delete (projects keep their template id).
create policy templates_select on public.templates for select to authenticated
  using ((select public.is_internal()));
create policy templates_admin_insert on public.templates for insert to authenticated
  with check ((select public.is_admin()) and not builtin and created_by = (select auth.uid()));
create policy templates_admin_update on public.templates for update to authenticated
  using ((select public.is_admin()) and not builtin) with check ((select public.is_admin()) and not builtin);

-- Same signature and rules as 0001; the gates and exit criteria now come from public.templates,
-- so Admin-made templates work exactly like the built-ins. Archived templates can't be used.
create or replace function public.create_project_from_template(
  p_key text,
  p_name text,
  p_client_org_id uuid,
  p_lead_id uuid,
  p_template_id text default 'kdf-hybrid',
  p_methodology public.methodology default 'hybrid',
  p_contract_type public.contract_type default 'fixed_fee',
  p_bac numeric default 0,
  p_start_date date default null,
  p_target_date date default null,
  p_restricted boolean default false,
  p_estimate_unit public.estimate_unit default 'points',
  p_description text default '')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.current_profile_role();
  v_project_id uuid;
  v_phase_id uuid;
  v_phase record;
  v_tpl public.templates;
  v_i integer;
begin
  if v_role is null or v_role not in ('admin', 'delivery_lead') then
    raise exception 'Only admins and delivery leads can create projects' using errcode = '42501';
  end if;
  if v_role = 'delivery_lead' and p_lead_id <> auth.uid() then
    raise exception 'A delivery lead can only create projects they lead' using errcode = '42501';
  end if;
  select * into v_tpl from public.templates where id = p_template_id and archived_at is null;
  if not found then
    raise exception 'unknown template %', p_template_id using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_client_org_id and type = 'client') then
    raise exception 'client org % not found', p_client_org_id using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_lead_id
                 and role in ('admin', 'delivery_lead') and deactivated_at is null) then
    raise exception 'lead must be an admin or delivery lead' using errcode = '22023';
  end if;

  insert into public.projects (key, name, client_org_id, lead_id, start_date, target_date, methodology,
    contract_type, description, restricted, estimate_unit, template_id)
  values (upper(p_key), p_name, p_client_org_id, p_lead_id, p_start_date, p_target_date, p_methodology,
    p_contract_type, coalesce(p_description, ''), p_restricted, p_estimate_unit, p_template_id)
  returning id into v_project_id;

  insert into public.project_financials (project_id, bac) values (v_project_id, coalesce(p_bac, 0));
  insert into public.project_members (project_id, user_id, project_role)
  values (v_project_id, p_lead_id, 'Delivery Lead');

  for v_phase in
    select (e ->> 'gate')::int as gate, e ->> 'name' as name,
           array(select jsonb_array_elements_text(e -> 'criteria')) as criteria
    from jsonb_array_elements(v_tpl.phases) e
    order by 1
  loop
    insert into public.phases (project_id, gate, name, status)
    values (v_project_id, v_phase.gate, v_phase.name,
            case when v_phase.gate = 1 then 'active' else 'not_started' end::public.phase_status)
    returning id into v_phase_id;
    for v_i in 1 .. coalesce(array_length(v_phase.criteria, 1), 0) loop
      insert into public.gate_criteria (project_id, phase_id, text, position)
      values (v_project_id, v_phase_id, v_phase.criteria[v_i], v_i);
    end loop;
  end loop;

  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after)
  values (auth.uid(), v_project_id, 'project.create', 'project', v_project_id::text,
          jsonb_build_object('key', upper(p_key), 'template', p_template_id, 'bac', p_bac));
  return v_project_id;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Workflow: per-project column labels and WIP limits. No row means the default workflow.
-- ---------------------------------------------------------------------------
create table public.project_workflows (
  project_id uuid primary key references public.projects (id) on delete cascade,
  -- [{"id": "backlog", "label": "Backlog", "wipLimit": null}, ...] in the fixed status order
  statuses jsonb not null check (jsonb_typeof(statuses) = 'array'),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create or replace function public.tg_project_workflows_check()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_ids text[];
begin
  select array_agg(e ->> 'id' order by n) into v_ids
  from jsonb_array_elements(new.statuses) with ordinality t(e, n);
  if v_ids is distinct from array['backlog', 'ready', 'in_progress', 'in_review', 'client_review', 'done', 'accepted'] then
    raise exception 'Columns cannot be added, removed or reordered; rename them instead.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.statuses) e
             where e ->> 'id' = 'accepted'
               and (e ->> 'label' is distinct from 'Accepted' or coalesce(e -> 'wipLimit', 'null'::jsonb) <> 'null'::jsonb)) then
    raise exception 'Accepted is fixed: it cannot be renamed, limited or removed, and only the client can set it.'
      using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(new.statuses) e
             where char_length(btrim(coalesce(e ->> 'label', ''))) not between 1 and 40
                or (coalesce(e -> 'wipLimit', 'null'::jsonb) <> 'null'::jsonb
                    and (jsonb_typeof(e -> 'wipLimit') <> 'number'
                         or (e ->> 'wipLimit') !~ '^[0-9]+$'
                         or (e ->> 'wipLimit')::int not between 1 and 999)))
     or (select count(distinct lower(btrim(e ->> 'label'))) from jsonb_array_elements(new.statuses) e) <> 7 then
    raise exception 'Every column needs a unique name (1 to 40 characters) and a WIP limit of 1 to 999 or none.'
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger project_workflows_check before insert or update on public.project_workflows
  for each row execute function public.tg_project_workflows_check();

alter table public.project_workflows enable row level security;

-- Everyone on the project reads the board's labels; only Admins configure them (Admin console).
create policy project_workflows_select on public.project_workflows for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy project_workflows_admin_write on public.project_workflows for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 6. Custom fields (workspace-wide) and their values on work items.
-- ---------------------------------------------------------------------------
create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  kind text not null check (kind in ('text', 'number', 'date', 'select')),
  options text[] not null default '{}',
  -- Shared fields (and their values on shared items) show in the client portal.
  visibility public.visibility not null default 'internal',
  position integer not null default 0,
  archived_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check ((kind = 'select' and cardinality(options) between 1 and 50) or (kind <> 'select' and cardinality(options) = 0))
);
create unique index custom_fields_name_active on public.custom_fields (lower(name)) where archived_at is null;

create or replace function public.tg_custom_fields_kind()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'A field''s type cannot change; archive it and add a new one' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger custom_fields_kind before update on public.custom_fields
  for each row execute function public.tg_custom_fields_kind();

create table public.custom_field_values (
  project_id uuid not null,
  item_id uuid not null,
  field_id uuid not null references public.custom_fields (id) on delete cascade,
  value text not null check (char_length(value) between 1 and 500),
  updated_by uuid references public.profiles (id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (item_id, field_id),
  foreign key (item_id, project_id) references public.work_items (id, project_id) on delete cascade
);
create index custom_field_values_project_idx on public.custom_field_values (project_id);
create index custom_field_values_field_idx on public.custom_field_values (field_id);

-- Values match the field's type (mirrors normaliseFieldValue); archived fields take no new values.
create or replace function public.tg_custom_field_values_check()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f public.custom_fields;
begin
  select * into f from public.custom_fields where id = new.field_id;
  if not found then raise exception 'field not found' using errcode = '23503'; end if;
  if f.archived_at is not null then
    raise exception '% is archived' , f.name using errcode = '23514';
  end if;
  if (f.kind = 'number' and new.value !~ '^-?[0-9]+(\.[0-9]+)?$')
     or (f.kind = 'date' and (new.value !~ '^\d{4}-\d{2}-\d{2}$' or to_char(new.value::date, 'YYYY-MM-DD') <> new.value))
     or (f.kind = 'select' and not (new.value = any (f.options))) then
    raise exception '% does not accept %', f.name, new.value using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger custom_field_values_check before insert or update on public.custom_field_values
  for each row execute function public.tg_custom_field_values_check();

alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;

create policy custom_fields_select on public.custom_fields for select to authenticated using (
  (select public.is_internal()) or (visibility = 'shared' and archived_at is null));
create policy custom_fields_admin_write on public.custom_fields for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- A value is visible when its item and its field are (both through the caller's own RLS): clients
-- see shared fields on shared items of their org only.
create policy custom_field_values_select on public.custom_field_values for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.work_items w where w.id = item_id and w.deleted_at is null)
  and exists (select 1 from public.custom_fields f where f.id = field_id));
create policy custom_field_values_write on public.custom_field_values for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids())
              and exists (select 1 from public.work_items w where w.id = item_id));

-- ---------------------------------------------------------------------------
-- 7. Attachments: comments, per-client bucket, size and type limits.
-- ---------------------------------------------------------------------------
alter table public.attachments
  add column comment_id uuid references public.comments (id) on delete cascade,
  add column bucket text check (bucket is null or bucket ~ '^[a-z0-9][a-z0-9.-]{1,62}$'),
  add constraint attachments_size_limit check (size_bytes is null or size_bytes <= 26214400),
  add constraint attachments_type_allowed check (mime_type is null or mime_type in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
create index attachments_comment_idx on public.attachments (comment_id) where comment_id is not null;

-- A file on a comment hangs off the comment's own parent, and a file on an internal comment is internal.
create or replace function public.tg_attachments_rules()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.comments;
begin
  if new.comment_id is not null then
    select * into c from public.comments where id = new.comment_id;
    if not found or c.entity_type <> new.entity_type or c.entity_id <> new.entity_id
       or c.project_id <> new.project_id then
      raise exception 'comment not found on this entity' using errcode = '23503';
    end if;
    if c.visibility = 'internal' then
      new.visibility := 'internal';
    end if;
  end if;
  return new;
end $$;

create trigger attachments_rules before insert on public.attachments
  for each row execute function public.tg_attachments_rules();

-- Same shape as 0001, plus: a file on a comment is visible only while the comment is.
drop policy attachments_select on public.attachments;
drop policy attachments_insert on public.attachments;
create policy attachments_select on public.attachments for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal())
       or (visibility = 'shared' and public.entity_visible(entity_type, entity_id)))
  and (comment_id is null or exists (select 1 from public.comments c where c.id = attachments.comment_id)));
create policy attachments_insert on public.attachments for insert to authenticated with check (
  uploaded_by = (select auth.uid())
  and project_id in (select public.visible_project_ids())
  and (select public.current_profile_role()) <> 'client_viewer'
  and public.entity_visible(entity_type, entity_id)
  and ((select public.is_internal()) or visibility = 'shared')
  and (comment_id is null or exists (select 1 from public.comments c where c.id = attachments.comment_id)));

-- ---------------------------------------------------------------------------
-- Privileges for the new tables and functions.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.templates to authenticated;
grant select, insert, update, delete on public.project_workflows, public.custom_fields,
  public.custom_field_values to authenticated;
grant all on public.templates, public.project_workflows, public.custom_fields, public.custom_field_values
  to service_role;
revoke execute on function public.tg_profiles_admin_rules(), public.tg_audit_profile_activation(),
  public.tg_audit_log_client_ip(), public.tg_invites_role_org(), public.tg_templates_check(),
  public.tg_project_workflows_check(), public.tg_custom_fields_kind(), public.tg_custom_field_values_check(),
  public.tg_attachments_rules() from public, anon;
