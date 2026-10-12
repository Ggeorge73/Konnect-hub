-- Team Pulse: agile metrics status history (AGL-01) and weekly status reports (RPT-01).
-- Mirrors lib/domain/{metrics,reports}.ts and lib/data/{pulse-history,metrics,reports}.ts.

-- ---------------------------------------------------------------------------
-- status_history: one row per work-item status change, written by a trigger so every path
-- (API, transition_work_item(), system reopen) is recorded. Internal users read it.
-- ---------------------------------------------------------------------------
create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  item_id uuid not null,
  from_status public.item_status,
  to_status public.item_status not null,
  changed_by uuid references public.profiles (id),
  at timestamptz not null default now(),
  foreign key (item_id, project_id) references public.work_items (id, project_id) on delete cascade
);
create index status_history_project_idx on public.status_history (project_id, at);
create index status_history_item_idx on public.status_history (item_id, at);

alter table public.status_history enable row level security;

-- Metrics count internal items, so the history is internal-only. No write policies: the trigger
-- (SECURITY DEFINER) is the only writer, so history cannot be forged from the API.
create policy status_history_select on public.status_history for select to authenticated using (
  (select public.is_internal()) and project_id in (select public.visible_project_ids()));

create or replace function public.tg_work_items_status_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status then
    insert into public.status_history (project_id, item_id, from_status, to_status, changed_by)
    values (new.project_id, new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end $$;

create trigger work_items_status_history after update of status on public.work_items
  for each row execute function public.tg_work_items_status_history();

-- ---------------------------------------------------------------------------
-- status_reports (0001) become the client-facing published copy; the internal working copy and
-- the budget section live in their own tables (internal / financial RLS), as gate budgets do.
-- ---------------------------------------------------------------------------
alter table public.status_reports
  add column week_start date generated always as (date_trunc('week', period_start::timestamp)::date) stored,
  add column status text generated always as (
    case when published_at is null then 'draft' else 'published' end) stored,
  add column sections jsonb not null default '{}'::jsonb,
  add column rag_reason text not null default '',
  add column share_budget boolean not null default false,
  add column published_by uuid references public.profiles (id),
  add column updated_at timestamptz not null default now(),
  add constraint status_reports_one_per_week unique (project_id, week_start);

-- Internal working copy (all sections but budget) and what publish removed.
create table public.status_report_drafts (
  report_id uuid primary key references public.status_reports (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  sections jsonb not null default '{}'::jsonb,
  removed jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index status_report_drafts_project_idx on public.status_report_drafts (project_id);

-- Budget section: Leads and Admins only (canSeeFinancials).
create table public.status_report_budgets (
  report_id uuid primary key references public.status_reports (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  html text not null default ''
);
create index status_report_budgets_project_idx on public.status_report_budgets (project_id);

alter table public.status_report_drafts enable row level security;
alter table public.status_report_budgets enable row level security;

create policy status_report_drafts_internal on public.status_report_drafts for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy status_report_budgets_financial on public.status_report_budgets for all to authenticated
  using (public.can_see_financials(project_id)) with check (public.can_see_financials(project_id));

-- Publishing (or touching a published report) is for the project Lead or an Admin only.
-- A published row is always shared and stamped with who published it.
create or replace function public.tg_status_reports_publish_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_was boolean := tg_op = 'UPDATE' and (old.published_at is not null or old.visibility = 'shared');
  v_is boolean := new.published_at is not null or new.visibility = 'shared';
begin
  if current_user in ('authenticated', 'anon') and (v_is or v_was)
     and not public.can_manage_project(new.project_id) then
    raise exception 'Only the project Lead or an Admin can publish status reports' using errcode = '42501';
  end if;
  if v_is then
    new.visibility := 'shared';
    new.published_at := coalesce(new.published_at, now());
    if not v_was then new.published_by := coalesce(new.published_by, auth.uid()); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger status_reports_publish_guard before insert or update on public.status_reports
  for each row execute function public.tg_status_reports_publish_guard();

-- On publish by a signed-in user: audit entry plus an in-app notification for every client user
-- of the project's org (kind status_report_published; email delivery is a later story).
create or replace function public.tg_status_reports_published()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after)
    values (auth.uid(), new.project_id, 'status_report.publish', 'status_report', new.id::text,
            jsonb_build_object('week_start', new.week_start, 'share_budget', new.share_budget));
    insert into public.notifications (user_id, project_id, kind, title, link)
    select pr.id, p.id, 'status_report_published',
           format('Status report published: %s, week of %s', p.name, new.week_start),
           format('/portal/%s/reports/%s', p.key, new.id)
      from public.projects p
      join public.profiles pr on pr.org_id = p.client_org_id
     where p.id = new.project_id
       and pr.role in ('client_sponsor', 'client_member', 'client_viewer');
  end if;
  return null;
end $$;

create trigger status_reports_published after insert or update of published_at on public.status_reports
  for each row execute function public.tg_status_reports_published();

-- ---------------------------------------------------------------------------
-- Privileges for the new objects.
-- ---------------------------------------------------------------------------
grant select on public.status_history to authenticated;
grant select, insert, update, delete on public.status_report_drafts, public.status_report_budgets to authenticated;
grant all on public.status_history, public.status_report_drafts, public.status_report_budgets to service_role;
revoke execute on function public.tg_work_items_status_history(), public.tg_status_reports_publish_guard(),
  public.tg_status_reports_published() from public, anon;
