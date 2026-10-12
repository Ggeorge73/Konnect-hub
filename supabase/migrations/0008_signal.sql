-- Team Signal (NTF-01 notifications, RT-01 real time, ICS-01 calendar feed).
-- Mirrors lib/domain/notifications.ts, lib/domain/watchers.ts and lib/data/notify.ts.

-- ---------------------------------------------------------------------------
-- Item watchers. The reporter, assignee and commenters watch automatically; anyone who can see
-- the item may watch or unwatch it. `watching = false` records an explicit unwatch.
-- No project_id column: access follows the work item through work_items RLS.
-- ---------------------------------------------------------------------------
create table public.item_watchers (
  item_id uuid not null references public.work_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  watching boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index item_watchers_user_idx on public.item_watchers (user_id) where watching;

alter table public.item_watchers enable row level security;

-- Does this (other) user's role and project access allow them to see the item?
-- Mirrors work_items_select for an arbitrary user, so internal staff can auto-watch colleagues.
create or replace function public.watcher_can_see_item(p_user uuid, p_item uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.work_items w
    join public.projects p on p.id = w.project_id
    join public.profiles u on u.id = p_user
    where w.id = p_item
      and case
        when p.deleted_at is not null then u.role = 'admin'
        when u.role = 'admin' then true
        when u.role in ('client_sponsor', 'client_member', 'client_viewer') then
          p.client_org_id = u.org_id and w.visibility = 'shared' and w.deleted_at is null
        when p.restricted and not u.us_person then false
        when u.role = 'delivery_lead' and p.lead_id = u.id then true
        else exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = u.id)
      end)
$$;


-- Read: your own rows on items you can see; internal staff see every watcher on visible items.
create policy item_watchers_select on public.item_watchers for select to authenticated using (
  exists (select 1 from public.work_items w where w.id = item_id)
  and (user_id = (select auth.uid()) or (select public.is_internal())));
-- Write your own watch on an item you can see. Internal staff may also auto-watch a colleague
-- (assignee) on a visible item; a client never gets a watch on an item they cannot see.
create policy item_watchers_insert on public.item_watchers for insert to authenticated with check (
  exists (select 1 from public.work_items w where w.id = item_id)
  and (user_id = (select auth.uid()) or (select public.is_internal()))
  and public.watcher_can_see_item(user_id, item_id));
create policy item_watchers_update on public.item_watchers for update to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.work_items w where w.id = item_id))
  with check (user_id = (select auth.uid()));
create policy item_watchers_delete on public.item_watchers for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Per-user, per-kind channel (in-app / email / daily digest / off). Strictly personal.
-- Supersedes the coarse switches in public.notification_prefs for the kinds listed here.
-- ---------------------------------------------------------------------------
create table public.notification_channel_prefs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('mention', 'assignment', 'status_change', 'gate_requested',
    'gate_decided', 'deliverable_awaiting', 'sla_breach', 'risk_escalated', 'status_report_published')),
  channel text not null check (channel in ('in_app', 'email', 'digest', 'off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.notification_channel_prefs enable row level security;
create policy notification_channel_prefs_own on public.notification_channel_prefs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Client safety backstop for notifications: the dispatcher tags each notification with the
-- visibility of the content it describes; internal ones can never be addressed to a client.
-- Rows written before 0008 (and the legacy seed) carry null.
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column visibility public.visibility,
  add column emailed_at timestamptz,
  add column digested_at timestamptz;

create or replace function public.notifications_client_safe()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.visibility = 'internal'
     and exists (select 1 from public.profiles u where u.id = new.user_id
                 and u.role in ('client_sponsor', 'client_member', 'client_viewer')) then
    raise exception 'internal notifications cannot be sent to client users' using errcode = '42501';
  end if;
  if new.kind in ('sla_breach', 'risk_escalated')
     and exists (select 1 from public.profiles u where u.id = new.user_id
                 and u.role in ('client_sponsor', 'client_member', 'client_viewer')) then
    raise exception '% notifications are internal only', new.kind using errcode = '42501';
  end if;
  return new;
end $$;

create trigger notifications_client_safe before insert or update of user_id, visibility, kind
  on public.notifications for each row execute function public.notifications_client_safe();

grant select, insert, update, delete on public.item_watchers, public.notification_channel_prefs to authenticated;
grant all on public.item_watchers, public.notification_channel_prefs to service_role;
grant execute on function public.watcher_can_see_item(uuid, uuid) to authenticated, service_role;
revoke execute on function public.notifications_client_safe() from public;
