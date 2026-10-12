-- Konnect Hub core schema, access helpers, RLS and server-side rules.
-- Mirrors lib/domain/types.ts, lib/domain/permissions.ts and lib/domain/workflow.ts.
-- Target: Postgres 15+ / Supabase. Every table in public has RLS enabled.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_type as enum ('internal', 'client');
create type public.user_role as enum (
  'admin', 'delivery_lead', 'team_member', 'associate',
  'client_sponsor', 'client_member', 'client_viewer');
create type public.visibility as enum ('internal', 'shared');
create type public.methodology as enum ('hybrid', 'scrum', 'kanban', 'waterfall');
create type public.contract_type as enum ('fixed_fee', 'time_materials', 'retainer');
create type public.rag as enum ('green', 'amber', 'red');
create type public.project_status as enum ('active', 'on_hold', 'closed');
create type public.estimate_unit as enum ('points', 'hours');
create type public.phase_status as enum (
  'not_started', 'active', 'ready_for_review', 'approved', 'approved_with_conditions', 'rejected');
create type public.gate_decision as enum ('approved', 'approved_with_conditions', 'rejected');
create type public.sprint_status as enum ('planned', 'active', 'completed');
create type public.item_type as enum (
  'epic', 'feature', 'story', 'task', 'bug', 'change_request', 'client_request');
create type public.item_status as enum (
  'backlog', 'ready', 'in_progress', 'in_review', 'client_review', 'done', 'accepted');
create type public.priority as enum ('critical', 'high', 'medium', 'low');
create type public.ac_status as enum ('pending', 'accepted', 'rejected');
create type public.link_type as enum ('blocks', 'relates', 'duplicates');
create type public.entity_type as enum ('work_item', 'raid', 'deliverable', 'gate_review');
create type public.deliverable_status as enum ('draft', 'submitted', 'accepted', 'rejected');
create type public.raid_kind as enum ('risk', 'assumption', 'issue', 'dependency');
create type public.raid_status as enum ('open', 'in_progress', 'closed');
create type public.roam as enum ('resolved', 'owned', 'accepted', 'mitigated');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.org_type not null,
  logo_url text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id),
  name text not null,
  email text not null unique,
  role public.user_role not null,
  mfa_enabled boolean not null default false,
  us_person boolean not null default false,
  title text,
  skills text[] not null default '{}',
  timezone text,
  hours_per_week numeric(5, 2),
  created_at timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (org_id);

-- Cost rates live apart from profiles so non-admins can never read them (admin-only RLS).
create table public.profile_rates (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  cost_rate numeric(10, 2) not null check (cost_rate >= 0),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  name text not null,
  client_org_id uuid not null references public.organizations (id),
  lead_id uuid not null references public.profiles (id),
  start_date date,
  target_date date,
  methodology public.methodology not null default 'hybrid',
  contract_type public.contract_type not null default 'fixed_fee',
  description text not null default '',
  status public.project_status not null default 'active',
  restricted boolean not null default false,
  rag public.rag not null default 'green',
  rag_reason text,
  estimate_unit public.estimate_unit not null default 'points',
  template_id text not null default 'kdf-hybrid',
  next_item_number integer not null default 1 check (next_item_number > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_client_org_idx on public.projects (client_org_id);
create index projects_lead_idx on public.projects (lead_id);

-- Budget is internal-only (admin / delivery lead). Kept out of projects so clients can't read it.
create table public.project_financials (
  project_id uuid primary key references public.projects (id) on delete cascade,
  bac numeric(14, 2) not null default 0 check (bac >= 0),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_role text not null default '',
  allocation_pct numeric(5, 2) not null default 0 check (allocation_pct between 0 and 100),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.phases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  gate smallint not null check (gate between 1 and 5),
  name text not null,
  status public.phase_status not null default 'not_started',
  start_date date,
  end_date date,
  unique (project_id, gate),
  unique (id, project_id)
);

create table public.gate_criteria (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  phase_id uuid not null,
  text text not null,
  done boolean not null default false,
  done_by uuid references public.profiles (id),
  done_at timestamptz,
  position integer not null default 0,
  foreign key (phase_id, project_id) references public.phases (id, project_id) on delete cascade
);
create index gate_criteria_phase_idx on public.gate_criteria (phase_id);
create index gate_criteria_project_idx on public.gate_criteria (project_id);

create table public.gate_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  phase_id uuid not null,
  decision public.gate_decision not null,
  conditions text,
  reason text,
  decided_by uuid not null references public.profiles (id),
  decided_at timestamptz not null default now(),
  ip inet,
  foreign key (phase_id, project_id) references public.phases (id, project_id) on delete cascade,
  check (decision <> 'rejected' or coalesce(btrim(reason), '') <> ''),
  check (decision <> 'approved_with_conditions' or coalesce(btrim(conditions), '') <> '')
);
create index gate_reviews_project_idx on public.gate_reviews (project_id, phase_id);

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid,
  name text not null,
  start_date date not null,
  end_date date not null,
  goal text not null default '',
  status public.sprint_status not null default 'planned',
  capacity_hours numeric(8, 2),
  unique (id, project_id),
  foreign key (phase_id, project_id) references public.phases (id, project_id),
  check (end_date >= start_date)
);
create index sprints_project_idx on public.sprints (project_id, status);

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number integer not null,
  key text not null,
  type public.item_type not null,
  title text not null check (length(title) between 1 and 500),
  description text not null default '',
  status public.item_status not null default 'backlog',
  priority public.priority not null default 'medium',
  assignee_id uuid references public.profiles (id),
  reporter_id uuid not null references public.profiles (id),
  phase_id uuid,
  sprint_id uuid,
  parent_id uuid,
  estimate numeric(8, 2),
  due_date date,
  labels text[] not null default '{}',
  visibility public.visibility not null default 'internal',
  position numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(key, '') || ' ' || coalesce(title, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')
  ) stored,
  unique (project_id, number),
  unique (project_id, key),
  unique (id, project_id),
  foreign key (phase_id, project_id) references public.phases (id, project_id),
  foreign key (sprint_id, project_id) references public.sprints (id, project_id) on delete set null (sprint_id),
  foreign key (parent_id, project_id) references public.work_items (id, project_id) on delete set null (parent_id)
);
-- Board / backlog / sprint / my-work access paths sized for ~200k items.
create index work_items_board_idx on public.work_items (project_id, status, position) where deleted_at is null;
create index work_items_backlog_idx on public.work_items (project_id, position) where deleted_at is null;
create index work_items_sprint_idx on public.work_items (sprint_id, status) where sprint_id is not null;
create index work_items_assignee_idx on public.work_items (assignee_id, status) where assignee_id is not null;
create index work_items_parent_idx on public.work_items (parent_id) where parent_id is not null;
create index work_items_phase_idx on public.work_items (phase_id);
create index work_items_search_idx on public.work_items using gin (search_vector);
create index work_items_labels_idx on public.work_items using gin (labels);

create table public.acceptance_criteria (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  item_id uuid not null,
  text text not null,
  status public.ac_status not null default 'pending',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  position integer not null default 0,
  foreign key (item_id, project_id) references public.work_items (id, project_id) on delete cascade
);
create index acceptance_criteria_item_idx on public.acceptance_criteria (item_id, position);
create index acceptance_criteria_project_idx on public.acceptance_criteria (project_id);

create table public.item_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  from_id uuid not null,
  to_id uuid not null references public.work_items (id) on delete cascade,
  type public.link_type not null,
  foreign key (from_id, project_id) references public.work_items (id, project_id) on delete cascade,
  unique (from_id, to_id, type),
  check (from_id <> to_id)
);
create index item_links_to_idx on public.item_links (to_id);
create index item_links_project_idx on public.item_links (project_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type public.entity_type not null,
  entity_id uuid not null,
  author_id uuid not null references public.profiles (id),
  body text not null check (length(body) between 1 and 20000),
  visibility public.visibility not null default 'internal',
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_entity_idx on public.comments (entity_type, entity_id, created_at);
create index comments_project_idx on public.comments (project_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  entity_type public.entity_type not null,
  entity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid not null references public.profiles (id),
  visibility public.visibility not null default 'internal',
  created_at timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id);
create index attachments_project_idx on public.attachments (project_id);

create table public.deliverables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  phase_id uuid,
  name text not null,
  description text not null default '',
  status public.deliverable_status not null default 'draft',
  due_date date,
  visibility public.visibility not null default 'internal',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  foreign key (phase_id, project_id) references public.phases (id, project_id)
);
create index deliverables_project_idx on public.deliverables (project_id, status);

create table public.deliverable_items (
  project_id uuid not null,
  deliverable_id uuid not null,
  item_id uuid not null,
  primary key (deliverable_id, item_id),
  foreign key (deliverable_id, project_id) references public.deliverables (id, project_id) on delete cascade,
  foreign key (item_id, project_id) references public.work_items (id, project_id) on delete cascade
);
create index deliverable_items_item_idx on public.deliverable_items (item_id);
create index deliverable_items_project_idx on public.deliverable_items (project_id);

create table public.raid_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind public.raid_kind not null,
  title text not null,
  description text not null default '',
  category text,
  owner_id uuid references public.profiles (id),
  probability smallint not null default 1 check (probability between 1 and 5),
  impact smallint not null default 1 check (impact between 1 and 5),
  score smallint generated always as (probability * impact) stored,
  escalate boolean not null default false,
  roam public.roam,
  mitigation text,
  sla_due date,
  visibility public.visibility not null default 'internal',
  status public.raid_status not null default 'open',
  closure_note text,
  closed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index raid_entries_project_idx on public.raid_entries (project_id, kind, status);
create index raid_entries_owner_idx on public.raid_entries (owner_id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  item_id uuid references public.work_items (id) on delete set null,
  user_id uuid not null references public.profiles (id),
  entry_date date not null,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  billable boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);
create index time_entries_project_idx on public.time_entries (project_id, entry_date);
create index time_entries_user_idx on public.time_entries (user_id, entry_date);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  start_date date not null,
  end_date date not null,
  pct numeric(5, 2) not null check (pct between 0 and 100),
  check (end_date >= start_date)
);
create index allocations_project_idx on public.allocations (project_id);
create index allocations_user_idx on public.allocations (user_id, start_date);

create table public.status_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  rag public.rag not null,
  summary text not null default '',
  accomplishments text not null default '',
  next_steps text not null default '',
  risks text not null default '',
  visibility public.visibility not null default 'internal',
  author_id uuid not null references public.profiles (id),
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index status_reports_project_idx on public.status_reports (project_id, period_end desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);
create index notifications_project_idx on public.notifications (project_id);

create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_enabled boolean not null default true,
  in_app_enabled boolean not null default true,
  digest text not null default 'daily' check (digest in ('off', 'daily', 'weekly')),
  muted_kinds text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  project_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  at timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_project_idx on public.audit_log (project_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  item_id uuid references public.work_items (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null,
  detail text not null default '',
  visibility public.visibility not null default 'internal',
  at timestamptz not null default now()
);
create index activity_project_idx on public.activity (project_id, at desc);
create index activity_item_idx on public.activity (item_id, at desc) where item_id is not null;

-- ---------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER, stable, pinned search_path)
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_role()
returns public.user_role language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_us_person()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select us_person from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.is_client()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_profile_role() in ('client_sponsor', 'client_member', 'client_viewer'), false)
$$;

-- Internal = signed-in with an internal role. Unknown / anonymous callers are neither.
create or replace function public.is_internal()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_profile_role() in ('admin', 'delivery_lead', 'team_member', 'associate'), false)
$$;

-- Exact mirror of permissions.ts canSeeProject, as a set (for fast `in (select ...)` policies).
create or replace function public.visible_project_ids()
returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  with me as (
    select id, org_id, role, us_person from public.profiles where id = auth.uid()
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

create or replace function public.can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.visible_project_ids() v where v = p_project_id)
$$;

-- canManageProject: admin, or the project's own delivery lead.
create or replace function public.can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_see_project(p_project_id) and (
    public.is_admin()
    or exists (select 1 from public.projects p
               where p.id = p_project_id and p.lead_id = auth.uid()
                 and public.current_profile_role() = 'delivery_lead'))
$$;

-- canSeeFinancials: admin or delivery lead (on projects they can see).
create or replace function public.can_see_financials(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_profile_role() in ('admin', 'delivery_lead') and public.can_see_project(p_project_id)
$$;

-- Polymorphic parent check for comments/attachments. SECURITY INVOKER on purpose:
-- the lookups go through the caller's own RLS, so a hidden parent hides its children.
create or replace function public.entity_visible(p_type public.entity_type, p_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select case p_type
    when 'work_item' then exists (select 1 from public.work_items w where w.id = p_id)
    when 'raid' then exists (select 1 from public.raid_entries r where r.id = p_id)
    when 'deliverable' then exists (select 1 from public.deliverables d where d.id = p_id)
    when 'gate_review' then exists (select 1 from public.gate_reviews g where g.id = p_id)
  end
$$;

-- ---------------------------------------------------------------------------
-- Triggers: data rules that must hold no matter who writes
-- ---------------------------------------------------------------------------

-- Atomic item keys: the UPDATE row-locks the project and takes next_item_number.
create or replace function public.tg_work_items_assign_key()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text;
  v_num integer;
begin
  -- Explicit numbers are honoured only for owner-run imports (no signed-in user);
  -- current_user is the definer here, so the caller is identified by auth.uid().
  if new.number is null or auth.uid() is not null then
    update public.projects set next_item_number = next_item_number + 1
      where id = new.project_id
      returning key, next_item_number - 1 into v_key, v_num;
    if v_key is null then raise exception 'project % not found', new.project_id; end if;
    new.number := v_num;
  else
    select key into v_key from public.projects where id = new.project_id;
  end if;
  new.key := v_key || '-' || new.number;
  return new;
end $$;

create trigger work_items_assign_key before insert on public.work_items
  for each row execute function public.tg_work_items_assign_key();

-- Accepted may only be set through transition_work_item(): it sets the transaction-local
-- flag konnect.allow_accept, which is only honoured when not running as an API role
-- (i.e. inside the SECURITY DEFINER function), so a client can't set the flag itself.
create or replace function public.tg_work_items_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from 'accepted')
     and not (coalesce(current_setting('konnect.allow_accept', true), '') = 'on'
              and current_user not in ('authenticated', 'anon'))
  then
    raise exception 'Accepted can only be set via transition_work_item()' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.number <> old.number or new.key <> old.key then
      raise exception 'item number/key are immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger work_items_guard before insert or update on public.work_items
  for each row execute function public.tg_work_items_guard();

-- RAID: score >= 15 escalates; a risk can't be closed without a closure note.
create or replace function public.tg_raid_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.escalate := (new.probability * new.impact) >= 15;
  if new.kind = 'risk' and new.status = 'closed' and coalesce(btrim(new.closure_note), '') = '' then
    raise exception 'A risk cannot be closed without a closure note' using errcode = '23514';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger raid_rules before insert or update on public.raid_entries
  for each row execute function public.tg_raid_rules();

-- Audit log is append-only, even for table owners.
create or replace function public.tg_audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only (% blocked)', tg_op using errcode = '42501';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.tg_audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.tg_audit_log_immutable();

-- Users may edit their own profile, but not escalate role/org/us_person/mfa.
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    if new.role is distinct from old.role or new.org_id is distinct from old.org_id
       or new.us_person is distinct from old.us_person or new.mfa_enabled is distinct from old.mfa_enabled
       or new.email is distinct from old.email then
      raise exception 'only an admin can change role, org, email, US-person or MFA flags' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- Clients may only record a decision on acceptance criteria, not rewrite them.
create or replace function public.tg_acceptance_criteria_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and public.is_client() then
    if new.text is distinct from old.text or new.item_id is distinct from old.item_id
       or new.project_id is distinct from old.project_id or new.position is distinct from old.position then
      raise exception 'clients may only accept or reject criteria' using errcode = '42501';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end $$;

create trigger acceptance_criteria_guard before update on public.acceptance_criteria
  for each row execute function public.tg_acceptance_criteria_guard();

-- ---------------------------------------------------------------------------
-- Server-side business functions
-- ---------------------------------------------------------------------------

-- Mirrors workflow.ts canTransition. The only way to reach 'accepted'.
create or replace function public.transition_work_item(
  p_item_id uuid,
  p_to_status public.item_status,
  p_offline_note text default null)
returns public.work_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.current_profile_role();
  v_item public.work_items;
  v_is_client boolean := v_role in ('client_sponsor', 'client_member', 'client_viewer');
  v_offline boolean := false;
  v_from public.item_status;
begin
  if v_role is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_item from public.work_items where id = p_item_id for update;
  if not found or v_item.deleted_at is not null
     or not public.can_see_project(v_item.project_id)
     or (v_is_client and v_item.visibility <> 'shared') then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;

  v_from := v_item.status;
  if v_from = p_to_status then
    return v_item;
  end if;
  if v_role = 'client_viewer' then
    raise exception 'Viewers are read-only.' using errcode = '42501';
  end if;

  if p_to_status = 'accepted' then
    if v_role in ('client_sponsor', 'client_member') then
      null;
    elsif v_role in ('delivery_lead', 'admin') and coalesce(btrim(p_offline_note), '') <> '' then
      v_offline := true;
    else
      raise exception 'Only the client can mark work Accepted. A Lead may record an offline acceptance with a note.'
        using errcode = '42501';
    end if;
  elsif v_is_client and v_item.status = 'accepted' then
    raise exception 'Clients cannot reopen accepted work here; reject the deliverable instead.' using errcode = '42501';
  elsif v_is_client and p_to_status not in ('client_review', 'in_progress') then
    raise exception 'Clients may only accept work or send it back.' using errcode = '42501';
  end if;

  perform set_config('konnect.allow_accept', 'on', true);
  update public.work_items set status = p_to_status where id = p_item_id returning * into v_item;
  perform set_config('konnect.allow_accept', 'off', true);

  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_item.project_id,
          case when v_offline then 'item.offline_acceptance' else 'item.transition' end,
          'work_item', v_item.id::text,
          jsonb_build_object('status', v_from),
          jsonb_build_object('status', p_to_status, 'offline_note', nullif(btrim(p_offline_note), '')));

  insert into public.activity (project_id, item_id, actor_id, action, detail, visibility)
  values (v_item.project_id, v_item.id, auth.uid(),
          case when p_to_status = 'accepted' then 'item.accepted' else 'item.status' end,
          v_item.key || ' moved to ' || p_to_status::text
            || case when v_offline then ' (offline acceptance recorded by lead)' else '' end,
          v_item.visibility);

  return v_item;
end $$;

-- Creates a project with its financials, the lead as a member, five gated phases and
-- the template's gate criteria. Mirrors lib/domain/templates.ts.
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
  v_i integer;
begin
  if v_role is null or v_role not in ('admin', 'delivery_lead') then
    raise exception 'Only admins and delivery leads can create projects' using errcode = '42501';
  end if;
  if v_role = 'delivery_lead' and p_lead_id <> auth.uid() then
    raise exception 'A delivery lead can only create projects they lead' using errcode = '42501';
  end if;
  if p_template_id not in ('kdf-hybrid', 'kanban-retainer', 'advisory') then
    raise exception 'unknown template %', p_template_id using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_client_org_id and type = 'client') then
    raise exception 'client org % not found', p_client_org_id using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_lead_id
                 and role in ('admin', 'delivery_lead')) then
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
    select * from (values
      (1, 'Mobilize',   array['Project charter approved', 'Acceptance criteria approved']),
      (2, 'Plan',       array['Baseline schedule approved', 'Baseline budget approved']),
      (3, 'Execute',    case p_template_id
                          when 'kanban-retainer' then array['Monthly service review accepted']
                          when 'advisory' then array['Findings report accepted']
                          else array['Each increment demonstrated and accepted'] end),
      (4, 'Accept',     array['UAT passed', 'Go-live readiness signed']),
      (5, 'Transition', array['Stabilization targets met', 'Handover signed'])
    ) as t(gate, name, criteria)
  loop
    insert into public.phases (project_id, gate, name, status)
    values (v_project_id, v_phase.gate, v_phase.name,
            case when v_phase.gate = 1 then 'active' else 'not_started' end::public.phase_status)
    returning id into v_phase_id;
    for v_i in 1 .. array_length(v_phase.criteria, 1) loop
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
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_rates enable row level security;
alter table public.projects enable row level security;
alter table public.project_financials enable row level security;
alter table public.project_members enable row level security;
alter table public.phases enable row level security;
alter table public.gate_criteria enable row level security;
alter table public.gate_reviews enable row level security;
alter table public.sprints enable row level security;
alter table public.work_items enable row level security;
alter table public.acceptance_criteria enable row level security;
alter table public.item_links enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.deliverables enable row level security;
alter table public.deliverable_items enable row level security;
alter table public.raid_entries enable row level security;
alter table public.time_entries enable row level security;
alter table public.allocations enable row level security;
alter table public.status_reports enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.audit_log enable row level security;
alter table public.activity enable row level security;

-- organizations: own org, the internal org, every org for admin/lead/team (canSeeClientList),
-- otherwise the client orgs of projects the caller can see.
create policy organizations_select on public.organizations for select to authenticated using (
  id = (select public.current_org_id())
  or type = 'internal'
  or (select public.current_profile_role()) in ('admin', 'delivery_lead', 'team_member')
  or id in (select p.client_org_id from public.projects p
            where p.id in (select public.visible_project_ids())));
create policy organizations_admin_write on public.organizations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- profiles: internal users see everyone; clients see their own org and Konnector staff.
create policy profiles_select on public.profiles for select to authenticated using (
  (select public.is_internal())
  or org_id = (select public.current_org_id())
  or org_id in (select o.id from public.organizations o where o.type = 'internal'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_admin_write on public.profiles for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- profile_rates: admin only (canSeeCostRates).
create policy profile_rates_admin on public.profile_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- projects
create policy projects_select on public.projects for select to authenticated
  using (id in (select public.visible_project_ids()));
create policy projects_insert on public.projects for insert to authenticated with check (
  (select public.is_admin())
  or ((select public.current_profile_role()) = 'delivery_lead' and lead_id = (select auth.uid())));
create policy projects_update on public.projects for update to authenticated
  using (public.can_manage_project(id))
  with check ((select public.is_admin())
              or ((select public.current_profile_role()) = 'delivery_lead' and lead_id = (select auth.uid())));
create policy projects_delete on public.projects for delete to authenticated
  using ((select public.is_admin()));

-- project_financials: admin / delivery lead only (canSeeFinancials); writes by managers.
create policy project_financials_select on public.project_financials for select to authenticated
  using (public.can_see_financials(project_id));
create policy project_financials_write on public.project_financials for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- project_members
create policy project_members_select on public.project_members for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy project_members_write on public.project_members for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- phases / gate_criteria: everyone on the project reads; managers write.
create policy phases_select on public.phases for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy phases_write on public.phases for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));
create policy gate_criteria_select on public.gate_criteria for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy gate_criteria_write on public.gate_criteria for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- gate_reviews: readable on the project; only the client sponsor records decisions (canApproveGates).
-- Decisions are permanent records: no update/delete policy.
create policy gate_reviews_select on public.gate_reviews for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy gate_reviews_insert on public.gate_reviews for insert to authenticated with check (
  (select public.current_profile_role()) = 'client_sponsor'
  and decided_by = (select auth.uid())
  and project_id in (select public.visible_project_ids()));

-- sprints
create policy sprints_select on public.sprints for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy sprints_write on public.sprints for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- work_items: clients see shared, non-deleted items only; only internal staff write
-- (canEditItems). Clients change status only via transition_work_item().
create policy work_items_select on public.work_items for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or (visibility = 'shared' and deleted_at is null)));
create policy work_items_insert on public.work_items for insert to authenticated with check (
  (select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy work_items_update on public.work_items for update to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy work_items_delete on public.work_items for delete to authenticated
  using ((select public.is_admin()));

-- acceptance_criteria: follow the parent item's visibility.
create policy acceptance_criteria_select on public.acceptance_criteria for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.work_items w where w.id = item_id));
create policy acceptance_criteria_internal_write on public.acceptance_criteria for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy acceptance_criteria_client_decide on public.acceptance_criteria for update to authenticated
  using ((select public.current_profile_role()) in ('client_sponsor', 'client_member')
         and project_id in (select public.visible_project_ids())
         and exists (select 1 from public.work_items w where w.id = item_id))
  with check ((select public.current_profile_role()) in ('client_sponsor', 'client_member')
              and project_id in (select public.visible_project_ids()));

-- item_links: both ends must be visible to the caller.
create policy item_links_select on public.item_links for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.work_items w where w.id = from_id)
  and exists (select 1 from public.work_items w where w.id = to_id));
create policy item_links_write on public.item_links for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- comments: clients see shared comments on entities they can see; viewers can't comment;
-- clients can only post shared comments. Authors edit/delete their own.
create policy comments_select on public.comments for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal())
       or (visibility = 'shared' and public.entity_visible(entity_type, entity_id))));
create policy comments_insert on public.comments for insert to authenticated with check (
  author_id = (select auth.uid())
  and project_id in (select public.visible_project_ids())
  and (select public.current_profile_role()) <> 'client_viewer'
  and public.entity_visible(entity_type, entity_id)
  and ((select public.is_internal()) or visibility = 'shared'));
create policy comments_update_own on public.comments for update to authenticated
  using (author_id = (select auth.uid()) and project_id in (select public.visible_project_ids()))
  with check (author_id = (select auth.uid())
              and ((select public.is_internal()) or visibility = 'shared'));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()));

-- attachments: same shape as comments.
create policy attachments_select on public.attachments for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal())
       or (visibility = 'shared' and public.entity_visible(entity_type, entity_id))));
create policy attachments_insert on public.attachments for insert to authenticated with check (
  uploaded_by = (select auth.uid())
  and project_id in (select public.visible_project_ids())
  and (select public.current_profile_role()) <> 'client_viewer'
  and public.entity_visible(entity_type, entity_id)
  and ((select public.is_internal()) or visibility = 'shared'));
create policy attachments_delete on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.is_admin()));

-- deliverables
create policy deliverables_select on public.deliverables for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or visibility = 'shared'));
create policy deliverables_write on public.deliverables for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

create policy deliverable_items_select on public.deliverable_items for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.deliverables d where d.id = deliverable_id)
  and exists (select 1 from public.work_items w where w.id = item_id));
create policy deliverable_items_write on public.deliverable_items for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- raid_entries
create policy raid_entries_select on public.raid_entries for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or visibility = 'shared'));
create policy raid_entries_write on public.raid_entries for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- time_entries: internal only. Own entries, or all on a project for admin / its lead.
create policy time_entries_select on public.time_entries for select to authenticated using (
  (select public.is_internal())
  and project_id in (select public.visible_project_ids())
  and (user_id = (select auth.uid()) or public.can_manage_project(project_id)));
create policy time_entries_write_own on public.time_entries for all to authenticated
  using ((select public.is_internal()) and user_id = (select auth.uid())
         and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and user_id = (select auth.uid())
              and project_id in (select public.visible_project_ids()));
create policy time_entries_manage on public.time_entries for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- allocations: internal planning data.
create policy allocations_select on public.allocations for select to authenticated using (
  (select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy allocations_write on public.allocations for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- status_reports: clients see shared (published) ones.
create policy status_reports_select on public.status_reports for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or visibility = 'shared'));
create policy status_reports_write on public.status_reports for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- notifications: strictly personal. Internal staff may notify anyone on a visible project.
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_insert on public.notifications for insert to authenticated with check (
  user_id = (select auth.uid())
  or ((select public.is_internal())
      and (project_id is null or project_id in (select public.visible_project_ids()))));

create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- audit_log: admins read; anyone may append an entry attributed to themselves.
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- activity: project feed; clients see shared events only.
create policy activity_select on public.activity for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or visibility = 'shared'));
create policy activity_insert on public.activity for insert to authenticated with check (
  actor_id = (select auth.uid())
  and project_id in (select public.visible_project_ids())
  and ((select public.is_internal()) or visibility = 'shared'));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Append-only audit log.
revoke update, delete, truncate on public.audit_log from public, anon, authenticated, service_role;

-- Functions: no anonymous access; signed-in users may call helpers and RPCs.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
