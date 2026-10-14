-- 0011_capacity.sql — Team Capacity (PI-1 Sprint 4): people directory fields, weekly allocations,
-- the allocation-grid totals and the U.S.-person rule for restricted projects (KH-34, KH-35, KH-36).
-- Mirrors lib/domain/capacity.ts and lib/data/capacity.ts (demo store).

-- ---------------------------------------------------------------------------
-- Directory fields (PPL-01)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column certifications text[] not null default '{}',
  add column location text;

-- ---------------------------------------------------------------------------
-- Weekly allocations (CAP-01): one row per person, project and ISO week (start_date = Monday,
-- end_date = Sunday) with the planned hours. pct is kept as hours / weekly capacity (capped at 100).
-- ---------------------------------------------------------------------------
alter table public.allocations
  add column hours numeric(6, 2) not null default 0 check (hours >= 0 and hours <= 168);

-- Existing date-range rows become weekly rows (hours = capacity × pct).
with moved as (
  delete from public.allocations returning project_id, user_id, start_date, end_date, pct
), weekly as (
  select m.project_id, m.user_id, w::date as week,
         sum(round(coalesce(p.hours_per_week, 40) * m.pct / 100, 2)) as hours
  from moved m
  join public.profiles p on p.id = m.user_id,
  generate_series(date_trunc('week', m.start_date::timestamp), m.end_date::timestamp, interval '7 days') w
  group by 1, 2, 3
)
insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours)
  select project_id, user_id, week, week + 6, 0, least(hours, 168) from weekly;

create unique index allocations_week_uniq on public.allocations (project_id, user_id, start_date);

create or replace function public.tg_allocations_week()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cap numeric;
begin
  if extract(isodow from new.start_date) <> 1 then
    raise exception 'Allocations are weekly: start_date must be a Monday' using errcode = '22023';
  end if;
  new.end_date := new.start_date + 6;
  select coalesce(nullif(hours_per_week, 0), 40) into v_cap from public.profiles where id = new.user_id;
  new.pct := least(100, round(new.hours / coalesce(v_cap, 40) * 100, 2));
  return new;
end $$;

create trigger allocations_week before insert or update on public.allocations
  for each row execute function public.tg_allocations_week();

-- ---------------------------------------------------------------------------
-- Allocation-grid totals: hours per person and ISO week across ALL projects (visible or not), so
-- load is right even when the caller can't see every project. No project ids or names leave the
-- function. Admins, Delivery Leads and Team Members only (associates and clients get nothing).
-- ---------------------------------------------------------------------------
create or replace function public.capacity_week_totals(p_from date, p_to date)
returns table (user_id uuid, week date, hours numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.user_id, a.start_date, sum(a.hours)
  from public.allocations a
  join public.projects p on p.id = a.project_id and p.deleted_at is null
  where public.current_profile_role() in ('admin', 'delivery_lead', 'team_member')
    and a.start_date between p_from and p_to
  group by a.user_id, a.start_date
$$;
revoke execute on function public.capacity_week_totals(date, date) from public, anon;
grant execute on function public.capacity_week_totals(date, date) to authenticated;

-- Leads edit skills and certifications of anyone in the directory (profiles RLS only lets a user
-- update their own row, and Admins everyone). Admins use it too.
create or replace function public.set_person_tags(p_user uuid, p_skills text[], p_certifications text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.current_profile_role() not in ('admin', 'delivery_lead') then
    raise exception 'Only Admins and Delivery Leads can edit skills and certifications' using errcode = '42501';
  end if;
  update public.profiles
     set skills = coalesce(p_skills, skills),
         certifications = coalesce(p_certifications, certifications)
   where id = p_user and role not in ('client_sponsor', 'client_member', 'client_viewer');
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.set_person_tags(uuid, text[], text[]) from public, anon;
grant execute on function public.set_person_tags(uuid, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Restricted projects (SEC-02): only U.S. persons may be members, have allocations or be assignees.
-- Enforced for every writer (including direct inserts by a Lead and the table owner).
-- ---------------------------------------------------------------------------

-- The refusal message for putting p_user on p_project, or null when allowed (restrictedRefusal()).
create or replace function public.restricted_refusal(p_project uuid, p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select format('%s is not a U.S. person and cannot be assigned to restricted project %s.', u.name, p.key)
  from public.projects p join public.profiles u on u.id = p_user
  where p.id = p_project and p.restricted and not u.us_person
$$;
revoke execute on function public.restricted_refusal(uuid, uuid) from public, anon;
grant execute on function public.restricted_refusal(uuid, uuid) to authenticated;

create or replace function public.tg_restricted_assignment()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid;
  v_msg text;
begin
  if tg_table_name = 'work_items' then
    v_user := new.assignee_id;
    if v_user is null or new.deleted_at is not null then return new; end if;
    if tg_op = 'UPDATE' and v_user is not distinct from old.assignee_id
       and new.project_id is not distinct from old.project_id then
      return new;
    end if;
  elsif tg_table_name = 'allocations' then
    v_user := new.user_id;
    if new.hours <= 0 then return new; end if;
  else
    v_user := new.user_id;
  end if;
  v_msg := public.restricted_refusal(new.project_id, v_user);
  if v_msg is not null then
    raise exception '%', v_msg using errcode = '23514';
  end if;
  return new;
end $$;

create trigger project_members_restricted before insert or update on public.project_members
  for each row execute function public.tg_restricted_assignment();
create trigger allocations_restricted before insert or update on public.allocations
  for each row execute function public.tg_restricted_assignment();
create trigger work_items_restricted before insert or update of assignee_id, project_id on public.work_items
  for each row execute function public.tg_restricted_assignment();

-- Non-U.S. people on a project: members, assignees of live items and anyone with allocations.
create or replace function public.non_us_people_on(p_project uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct u.name order by u.name), '{}')
  from public.profiles u
  where not u.us_person and (
    exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = u.id)
    or exists (select 1 from public.work_items w where w.project_id = p_project and w.assignee_id = u.id
               and w.deleted_at is null)
    or exists (select 1 from public.allocations a where a.project_id = p_project and a.user_id = u.id
               and a.hours > 0))
$$;
revoke execute on function public.non_us_people_on(uuid) from public, anon;
grant execute on function public.non_us_people_on(uuid) to authenticated;

-- Flipping a project to restricted is refused while non-U.S. people are still on it.
create or replace function public.tg_projects_restricted_flip()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_names text[];
begin
  if new.restricted and (tg_op = 'INSERT' or not old.restricted) then
    v_names := public.non_us_people_on(new.id);
    if cardinality(v_names) > 0 then
      raise exception 'Cannot mark % restricted: remove these non-U.S. people first: %.',
        new.key, array_to_string(v_names, ', ') using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger projects_restricted_flip before update of restricted on public.projects
  for each row execute function public.tg_projects_restricted_flip();

-- Clearing someone's U.S.-person flag is refused while they are on restricted projects.
create or replace function public.tg_profiles_us_person()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keys text;
begin
  if old.us_person and not new.us_person then
    select string_agg(distinct p.key, ', ' order by p.key) into v_keys
    from public.projects p
    where p.restricted and p.deleted_at is null
      and exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = new.id);
    if v_keys is not null then
      raise exception '% is on restricted projects (%); remove them first.', new.name, v_keys
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_us_person before update of us_person on public.profiles
  for each row execute function public.tg_profiles_us_person();
