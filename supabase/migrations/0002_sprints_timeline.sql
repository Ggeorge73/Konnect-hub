-- Sprint 2 (Team Flow): sprint planning rules and timeline scheduling.
-- SPR-01 sprints and backlog; TL-01 timeline. Mirrors lib/domain/sprints.ts.

-- Capacity: planned hours convert story points with a per-project rate (default 6 h per point).
alter table public.projects
  add column hours_per_point numeric(6, 2) not null default 6
  constraint projects_hours_per_point_range check (hours_per_point > 0 and hours_per_point <= 100);

-- A sprint ends after it starts, and capacity is never negative.
alter table public.sprints
  add constraint sprints_end_after_start check (end_date > start_date),
  add constraint sprints_capacity_nonneg check (capacity_hours is null or capacity_hours >= 0);

-- Only one active sprint per project (canStartSprint).
create unique index sprints_one_active_per_project on public.sprints (project_id) where status = 'active';

-- Sprint planning (create, start, complete, reschedule) is a Lead/Admin action (canManageProject).
-- Everyone who can see the project can still read its sprints (sprints_select is unchanged).
-- Moving items in and out of sprints is a work_items update, open to internal staff as before.
drop policy sprints_write on public.sprints;
create policy sprints_write on public.sprints for all to authenticated
  using (public.can_manage_project(project_id)) with check (public.can_manage_project(project_id));

-- Timeline: explicit dates for an epic bar, set by dragging it. When null, the bar spans its
-- children's sprint and due dates. Kept on work_items so the item's visibility RLS applies.
-- (The demo store keeps these in Db.planning.schedules.)
alter table public.work_items
  add column planned_start date,
  add column planned_end date,
  add constraint work_items_planned_range check (
    (planned_start is null) = (planned_end is null)
    and (planned_end is null or planned_end >= planned_start));
