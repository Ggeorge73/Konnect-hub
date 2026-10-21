-- Konnector CRM integration (docs/integration.md, docs/integration/crm-contract.md).
-- Mirrors lib/domain/crm.ts and lib/data/integration{,-postgres}.ts.
--
--   1. crm_accounts        client org ↔ CRM account id. Admin read only.
--   2. crm_projects        handoff details per project (contract no., value, scope, documents,
--                          change entries, last health sent). Admins and the project's Lead read.
--   3. client_items        quotes, amendments, renewal offers and surveys published by the CRM.
--                          Clients read their own organization's; Konnector users (not associates)
--                          read them on projects they can see (superseded versions stay readable
--                          so old links explain what replaced them). Nobody writes them directly: the
--                          CRM's events arrive through the server (service role) and client
--                          decisions go through the SECURITY DEFINER functions below.
--   4. integration_events  every inbound and outbound event with status, attempts and errors.
--                          Admin read only.
--   5. Notification kinds  commercial_review (clients) and commercial_decided (internal only).

-- ---------------------------------------------------------------------------
-- 1. Account mapping
-- ---------------------------------------------------------------------------
create table public.crm_accounts (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  crm_account_id text not null unique,
  linked_at timestamptz not null default now()
);
alter table public.crm_accounts enable row level security;
create policy crm_accounts_select on public.crm_accounts for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 2. Handoff details
-- ---------------------------------------------------------------------------
create table public.crm_projects (
  project_id uuid primary key references public.projects (id) on delete cascade,
  crm_account_id text not null,
  contract_no text not null default '',
  value numeric(14, 2) not null default 0 check (value >= 0),
  currency char(3) not null default 'USD',
  service_lines text[] not null default '{}',
  scope_summary text not null default '',
  acceptance_criteria text[] not null default '{}',
  documents jsonb not null default '[]',
  handoff_key text not null unique,
  changes jsonb not null default '[]',
  last_health jsonb,
  last_health_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.crm_projects enable row level security;
-- Contract value is commercial: Admins and Delivery Leads, on projects they can see.
create policy crm_projects_select on public.crm_projects for select to authenticated
  using (public.current_profile_role() in ('admin', 'delivery_lead')
         and project_id in (select public.visible_project_ids()));

-- ---------------------------------------------------------------------------
-- 3. Commercial items
-- ---------------------------------------------------------------------------
create table public.client_items (
  id text primary key check (length(id) between 1 and 200),
  lineage_id text not null,
  version integer not null check (version > 0),
  supersedes_version integer,
  type text not null check (type in ('quote', 'contract_amendment', 'renewal_offer', 'survey')),
  org_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  title text not null,
  summary text,
  amount numeric(14, 2) check (amount >= 0),
  currency char(3) not null,
  lines jsonb not null default '[]',
  terms text,
  new_end_date date,
  respond_by date,
  document jsonb,
  requires_signature boolean not null default false,
  status text not null default 'open'
    check (status in ('open', 'viewed', 'accepted', 'declined', 'changes_requested', 'withdrawn', 'superseded')),
  published_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  first_viewed_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_by_title text,
  decided_by_email text,
  decided_ip text,
  decision_note text,
  survey_score integer check (survey_score between 0 and 10),
  survey_comment text,
  withdrawn_reason text,
  reminded_at timestamptz,
  unique (lineage_id, version)
);
create index client_items_org_idx on public.client_items (org_id, status);
create index client_items_project_idx on public.client_items (project_id);
alter table public.client_items enable row level security;

create policy client_items_select on public.client_items for select to authenticated
  using (
    case
      when (select public.is_client()) then
        org_id = (select public.current_org_id())
      when public.current_profile_role() in ('admin', 'delivery_lead', 'team_member') then
        (project_id is not null and project_id in (select public.visible_project_ids()))
        or (project_id is null and (select public.is_admin()))
      else false
    end);

-- A client user may act on an open item of their own organization (rules in lib/domain/crm.ts).
create or replace function public.client_item_for_action(p_id text)
returns public.client_items language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_item public.client_items;
begin
  if not public.is_client() then
    raise exception 'Commercial items are owned by the CRM: Konnector users can only view them.'
      using errcode = '42501';
  end if;
  select * into v_item from public.client_items where id = p_id and org_id = public.current_org_id();
  if not found then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  if v_item.status = 'withdrawn' then
    raise exception 'This item was withdrawn by Konnector.' using errcode = '22023';
  end if;
  if v_item.status = 'superseded' then
    raise exception 'A newer version of this item replaces it.' using errcode = '22023';
  end if;
  return v_item;
end $$;

-- First open by a client user: returns true only the first time anyone in the org opens it.
-- Any status (a withdrawn item's old link still opens); nothing else changes.
create or replace function public.client_item_record_view(p_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_client() then return false; end if;
  if not exists (select 1 from public.client_items where id = p_id and org_id = public.current_org_id()) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  update public.client_items
     set first_viewed_at = now(), first_viewed_by = auth.uid(),
         status = case when status = 'open' then 'viewed' else status end
   where id = p_id and first_viewed_at is null;
  return found;
end $$;

-- Accept / decline / request changes. Sponsors (client admins and approvers) only.
create or replace function public.client_item_decide(
  p_id text, p_decision text, p_note text, p_name text, p_title text, p_ip text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.client_items := public.client_item_for_action(p_id);
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_item.status not in ('open', 'viewed') then
    raise exception 'This item has already been decided.' using errcode = '22023';
  end if;
  if v_item.type = 'survey' then
    raise exception 'Answer the survey instead.' using errcode = '22023';
  end if;
  if v_me.role <> 'client_sponsor' then
    raise exception 'Only your organization''s approvers can decide this.' using errcode = '42501';
  end if;
  if p_decision not in ('accepted', 'declined', 'changes_requested') then
    raise exception 'unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_decision = 'accepted' and v_item.requires_signature then
    raise exception 'This item is accepted by signing the document.' using errcode = '22023';
  end if;
  if p_decision = 'accepted' and (coalesce(trim(p_name), '') = '' or coalesce(trim(p_title), '') = '') then
    raise exception 'Enter your name and job title to accept.' using errcode = '22023';
  end if;
  if p_decision = 'changes_requested' and coalesce(trim(p_note), '') = '' then
    raise exception 'Tell Konnector what should change.' using errcode = '22023';
  end if;
  update public.client_items
     set status = p_decision, decided_at = now(), decided_by = v_me.id,
         decided_by_name = coalesce(nullif(trim(p_name), ''), v_me.name),
         decided_by_title = nullif(trim(p_title), ''), decided_by_email = v_me.email,
         decided_ip = p_ip, decision_note = nullif(trim(p_note), '')
   where id = p_id;
  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
  values (v_me.id, v_item.project_id, 'client_item.' || p_decision, 'client_item', p_id,
          jsonb_build_object('status', v_item.status),
          jsonb_build_object('status', p_decision, 'version', v_item.version,
                             'name', coalesce(nullif(trim(p_name), ''), v_me.name),
                             'title', nullif(trim(p_title), ''), 'email', v_me.email,
                             'note', nullif(trim(p_note), '')));
end $$;

create or replace function public.client_item_answer_survey(p_id text, p_score integer, p_comment text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item public.client_items := public.client_item_for_action(p_id);
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if v_item.type <> 'survey' then raise exception 'This item is not a survey.' using errcode = '22023'; end if;
  if v_item.status not in ('open', 'viewed') then
    raise exception 'This item has already been decided.' using errcode = '22023';
  end if;
  if v_me.role not in ('client_sponsor', 'client_member') then
    raise exception 'Your portal role cannot answer surveys.' using errcode = '42501';
  end if;
  update public.client_items
     set status = 'accepted', survey_score = p_score, survey_comment = nullif(trim(p_comment), ''),
         decided_at = now(), decided_by = v_me.id, decided_by_name = v_me.name, decided_by_email = v_me.email
   where id = p_id;
  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after)
  values (v_me.id, v_item.project_id, 'client_item.survey_submitted', 'client_item', p_id,
          jsonb_build_object('score', p_score));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Event log
-- ---------------------------------------------------------------------------
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inbound', 'outbound')),
  event text not null,
  idempotency_key text not null,
  status text not null check (status in ('pending', 'processed', 'failed', 'rejected', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  payload jsonb not null default '{}',
  response jsonb,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (direction, idempotency_key)
);
create index integration_events_due_idx on public.integration_events (next_attempt_at)
  where direction = 'outbound' and status in ('pending', 'failed');
create index integration_events_created_idx on public.integration_events (created_at desc);
alter table public.integration_events enable row level security;
create policy integration_events_select on public.integration_events for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Notification kinds
-- ---------------------------------------------------------------------------
alter table public.notification_channel_prefs drop constraint notification_channel_prefs_kind_check;
alter table public.notification_channel_prefs add constraint notification_channel_prefs_kind_check
  check (kind in ('mention', 'assignment', 'status_change', 'gate_requested', 'gate_decided',
                  'deliverable_awaiting', 'sla_breach', 'risk_escalated', 'status_report_published',
                  'commercial_review', 'commercial_decided'));

create or replace function public.notifications_client_safe()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.visibility = 'internal'
     and exists (select 1 from public.profiles u where u.id = new.user_id
                 and u.role in ('client_sponsor', 'client_member', 'client_viewer')) then
    raise exception 'internal notifications cannot be sent to client users' using errcode = '42501';
  end if;
  if new.kind in ('sla_breach', 'risk_escalated', 'commercial_decided')
     and exists (select 1 from public.profiles u where u.id = new.user_id
                 and u.role in ('client_sponsor', 'client_member', 'client_viewer')) then
    raise exception '% notifications are internal only', new.kind using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated users only read (RLS decides what); writes are service-role or RPC.
-- ---------------------------------------------------------------------------
grant select on public.crm_accounts, public.crm_projects, public.client_items, public.integration_events
  to authenticated;
grant all on public.crm_accounts, public.crm_projects, public.client_items, public.integration_events
  to service_role;
revoke execute on function public.client_item_for_action(text) from public, anon;
revoke execute on function public.client_item_record_view(text), public.client_item_decide(text, text, text, text, text, text),
  public.client_item_answer_survey(text, integer, text) from public, anon;
grant execute on function public.client_item_for_action(text), public.client_item_record_view(text),
  public.client_item_decide(text, text, text, text, text, text),
  public.client_item_answer_survey(text, integer, text) to authenticated, service_role;
