-- Team Ledger (PI-1 Sprint 4): time tracking with Lead approval (KH-37), approved time as EVM
-- actual cost, and audit entries for permission changes (KH-38). Mirrors lib/domain/ledger.ts.
--
-- time_entries (0001) already has RLS: internal users only; people read and write their own rows,
-- the project Lead / Admin read and manage every row on the project; clients see nothing.
-- This migration adds the approval lifecycle on top and enforces it in a trigger:
--   draft -> submitted (owner) -> approved | rejected (Lead / Admin; rejecting needs a reason)
--   rejected -> draft (owner edits) -> submitted ...
-- Approved rows are locked for everyone (no update, no delete).

create type public.time_status as enum ('draft', 'submitted', 'approved', 'rejected');

alter table public.time_entries
  add column status public.time_status not null default 'draft',
  add column submitted_at timestamptz,
  add column decided_by uuid references public.profiles (id),
  add column decided_at timestamptz,
  add column reject_reason text,
  add column updated_at timestamptz not null default now(),
  add constraint time_entries_quarter_hours check (hours * 4 = trunc(hours * 4));

create index time_entries_status_idx on public.time_entries (project_id, status, entry_date);
create index time_entries_item_idx on public.time_entries (item_id);

create or replace function public.tg_time_entry_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_manager boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      raise exception 'Approved time is locked' using errcode = '42501';
    end if;
    if v_user and old.status = 'submitted' and not public.can_manage_project(old.project_id) then
      raise exception 'Submitted time is read-only until your Lead decides' using errcode = '42501';
    end if;
    return old;
  end if;

  -- Only internal people log time, and the item must belong to the entry's project.
  if not exists (select 1 from public.profiles p where p.id = new.user_id
                 and p.role in ('admin', 'delivery_lead', 'team_member', 'associate')) then
    raise exception 'Only Konnector staff log time' using errcode = '42501';
  end if;
  if new.item_id is not null and not exists (
       select 1 from public.work_items w where w.id = new.item_id and w.project_id = new.project_id) then
    raise exception 'The work item is not in this project' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_user and new.status <> 'draft' then
      raise exception 'New time starts as a draft' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  if old.status = 'approved' then
    raise exception 'Approved time is locked' using errcode = '42501';
  end if;
  if new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id then
    raise exception 'Time cannot move to another person or project' using errcode = '42501';
  end if;
  v_manager := not v_user or public.can_manage_project(new.project_id);

  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if not v_manager then
      raise exception 'Only the project Lead or an Admin can approve time' using errcode = '42501';
    end if;
    if old.status <> 'submitted' then
      raise exception 'Only submitted time can be approved or rejected' using errcode = '23514';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then
      raise exception 'A reason is required to reject time' using errcode = '23514';
    end if;
    if new.status = 'approved' then new.reject_reason := null; end if;
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  elsif (new.entry_date, new.hours, new.billable, new.note, new.item_id)
        is distinct from (old.entry_date, old.hours, old.billable, old.note, old.item_id) then
    if old.status = 'submitted' then
      raise exception 'Submitted time is read-only until your Lead decides' using errcode = '42501';
    end if;
    -- Editing a rejected entry turns it back into a draft.
    if new.status = 'rejected' then new.status := 'draft'; end if;
  end if;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    if old.status not in ('draft', 'rejected') then
      raise exception 'Only draft time can be submitted' using errcode = '23514';
    end if;
    new.submitted_at := now();
    new.decided_by := null;
    new.decided_at := null;
  end if;
  if new.status = 'draft' and old.status = 'submitted' and not v_manager then
    raise exception 'Submitted time is read-only until your Lead decides' using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger time_entry_rules before insert or update or delete on public.time_entries
  for each row execute function public.tg_time_entry_rules();

-- Decisions are audited in the database, whichever path changed the row.
create or replace function public.tg_time_entry_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
    values (auth.uid(), new.project_id,
            case when new.status = 'approved' then 'time.approve' else 'time.reject' end,
            'time_entry', new.id::text, jsonb_build_object('status', old.status),
            jsonb_strip_nulls(jsonb_build_object('status', new.status, 'hours', new.hours,
                                                 'reason', new.reject_reason)));
  end if;
  return new;
end $$;

create trigger time_entry_audit after update on public.time_entries
  for each row execute function public.tg_time_entry_audit();

-- ---------------------------------------------------------------------------
-- item_logged_hours: total hours logged on an item by everyone, for the item side panel.
-- RLS only shows people their own rows, so this SECURITY DEFINER function returns the sum (never
-- the rows). Internal users only, on items they can see.
-- ---------------------------------------------------------------------------
create or replace function public.item_logged_hours(p_item_id uuid)
returns numeric language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
begin
  if not public.is_internal() then
    raise exception 'Time tracking is for Konnector staff' using errcode = '42501';
  end if;
  select w.project_id into v_project from public.work_items w
   where w.id = p_item_id and w.deleted_at is null
     and w.project_id in (select public.visible_project_ids());
  if v_project is null then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  return coalesce((select sum(t.hours) from public.time_entries t where t.item_id = p_item_id), 0);
end $$;

-- ---------------------------------------------------------------------------
-- project_actual_cost: EVM actual cost in integer cents = Σ approved hours × the person's cost
-- rate, for entries dated on or before p_as_of. Admin / Delivery Lead only (can_see_financials).
-- Leads get the total, never the rates (profile_rates stays admin-only).
-- ---------------------------------------------------------------------------
create or replace function public.project_actual_cost(p_project_id uuid, p_as_of date)
returns bigint language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_see_financials(p_project_id) then
    raise exception 'Actual cost is visible to Admins and Delivery Leads only' using errcode = '42501';
  end if;
  return coalesce((
    select sum(round(t.hours * coalesce(r.cost_rate, 0) * 100))::bigint
      from public.time_entries t
      left join public.profile_rates r on r.profile_id = t.user_id
     where t.project_id = p_project_id and t.status = 'approved' and t.entry_date <= p_as_of), 0);
end $$;

revoke execute on function public.item_logged_hours(uuid) from public, anon;
grant execute on function public.item_logged_hours(uuid) to authenticated, service_role;
revoke execute on function public.project_actual_cost(uuid, date) from public, anon;
grant execute on function public.project_actual_cost(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permission changes are audited wherever a signed-in user makes them (admin console, RPCs such
-- as create_project): a profile's role, and project membership (which decides visibility).
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit_permission_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Seeds and migrations run with no signed-in user; every request (and RPC) has one.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'profiles' then
    if new.role is distinct from old.role then
      insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
      values (auth.uid(), 'permission.role_change', 'profile', new.id::text,
              jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after)
    values (auth.uid(), new.project_id, 'permission.member_add', 'project_member', new.user_id::text,
            jsonb_build_object('project_role', new.project_role, 'allocation_pct', new.allocation_pct));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before)
    values (auth.uid(), old.project_id, 'permission.member_remove', 'project_member', old.user_id::text,
            jsonb_build_object('project_role', old.project_role, 'allocation_pct', old.allocation_pct));
    return old;
  elsif new.project_role is distinct from old.project_role then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
    values (auth.uid(), new.project_id, 'permission.member_change', 'project_member', new.user_id::text,
            jsonb_build_object('project_role', old.project_role),
            jsonb_build_object('project_role', new.project_role));
  end if;
  return new;
end $$;

create trigger profiles_audit_role after update of role on public.profiles
  for each row execute function public.tg_audit_permission_change();
create trigger project_members_audit after insert or update or delete on public.project_members
  for each row execute function public.tg_audit_permission_change();
