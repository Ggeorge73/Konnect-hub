-- RAID register (RAID-01 / RAID-02): decisions, issue severity and SLA, residual score,
-- stale-escalation bookkeeping, and links from RAID entries to work items.
-- Mirrors lib/domain/raid.ts; the demo store enforces the same rules in lib/data/raid.ts.

alter type public.raid_kind add value if not exists 'decision';
create type public.issue_severity as enum ('critical', 'major', 'minor');

alter table public.raid_entries
  add column severity public.issue_severity,
  add column residual_probability smallint check (residual_probability between 1 and 5),
  add column residual_impact smallint check (residual_impact between 1 and 5),
  add column residual_score smallint generated always as (residual_probability * residual_impact) stored,
  add column sla_due_at timestamptz,
  add column entry_date date,
  add column decided_by uuid references public.profiles (id),
  add column rationale text,
  add column escalated_at timestamptz,
  add constraint raid_entries_id_project_key unique (id, project_id);

-- Adds business days (Mon–Fri, UTC), keeping the time of day; weekend starts roll forward.
create or replace function public.add_business_days(p_start timestamptz, p_days integer)
returns timestamptz language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v timestamp := p_start at time zone 'UTC';
  v_added integer := 0;
begin
  while v_added < p_days loop
    v := v + interval '1 day';
    if extract(isodow from v) < 6 then v_added := v_added + 1; end if;
  end loop;
  return v at time zone 'UTC';
end $$;

-- Issue SLA: Critical 48 hours, Major 5 business days, Minor 10 business days.
create or replace function public.raid_sla_due(p_severity public.issue_severity, p_created timestamptz)
returns timestamptz language sql immutable set search_path = public, pg_temp as $$
  select case p_severity
    when 'critical' then p_created + interval '48 hours'
    when 'major' then public.add_business_days(p_created, 5)
    when 'minor' then public.add_business_days(p_created, 10)
  end
$$;

-- Same rules as 0001 plus: escalation bookkeeping (escalated_at) is not an "update",
-- so notifying about a stale issue never resets its staleness. updated_at uses clock time.
create or replace function public.tg_raid_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_ignore text[] := array['escalated_at', 'updated_at', 'escalate', 'score', 'residual_score'];
begin
  new.escalate := (new.probability * new.impact) >= 15;
  if new.kind = 'risk' and new.status = 'closed' and coalesce(btrim(new.closure_note), '') = '' then
    raise exception 'A risk cannot be closed without a closure note' using errcode = '23514';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;

-- SLA due is computed at creation (and recomputed from created_at if severity changes).
create or replace function public.tg_raid_sla()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.kind = 'issue' and new.severity is not null
     and (tg_op = 'INSERT' or new.severity is distinct from old.severity) then
    new.sla_due_at := public.raid_sla_due(new.severity, new.created_at);
  end if;
  return new;
end $$;

create trigger raid_sla before insert or update on public.raid_entries
  for each row execute function public.tg_raid_sla();

create table public.raid_links (
  project_id uuid not null,
  raid_id uuid not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (raid_id, item_id),
  foreign key (raid_id, project_id) references public.raid_entries (id, project_id) on delete cascade,
  foreign key (item_id, project_id) references public.work_items (id, project_id) on delete cascade
);
create index raid_links_item_idx on public.raid_links (item_id);
create index raid_links_project_idx on public.raid_links (project_id);

alter table public.raid_links enable row level security;

-- A link is visible only when both ends are visible to the caller (their own RLS applies).
create policy raid_links_select on public.raid_links for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.raid_entries r where r.id = raid_id)
  and exists (select 1 from public.work_items w where w.id = item_id));
create policy raid_links_write on public.raid_links for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

revoke all on public.raid_links from anon;
grant select, insert, update, delete on public.raid_links to authenticated;
grant all on public.raid_links to service_role;

revoke execute on function public.add_business_days(timestamptz, integer) from public, anon;
revoke execute on function public.raid_sla_due(public.issue_severity, timestamptz) from public, anon;
revoke execute on function public.tg_raid_sla() from public, anon;
grant execute on function public.add_business_days(timestamptz, integer) to authenticated, service_role;
grant execute on function public.raid_sla_due(public.issue_severity, timestamptz) to authenticated, service_role;
