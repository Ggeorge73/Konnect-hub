-- Team Insight (PI-1 Sprint 5): AI assist (CLAUDE.md 3.13, KH-42..44). Mirrors lib/data/ai.ts.
--
-- ai_settings              per-project switch, OFF by default (no row = off). Everyone who can see
--                          the project reads it (client thread summaries depend on it); only the
--                          project's Delivery Lead or an Admin writes it. Every change is audited
--                          by a trigger, so the audit cannot be skipped.
-- ai_suggestion_decisions  risk-suggestion signals a person accepted or dismissed, so the same
--                          suggestion is not shown again. Internal users only; append-only.
--
-- Nothing else is stored: prompts and model output are never persisted. Each AI call writes an
-- `ai.call` audit entry (feature, model, token counts; never prompt contents) through audit_log.

create table public.ai_settings (
  project_id uuid primary key references public.projects (id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.ai_suggestion_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  signal_key text not null
    check (signal_key ~ '^(stalled|overdue|sprint_miss|deliverable_late):[A-Za-z0-9_-]{1,80}$'),
  decision text not null check (decision in ('accepted', 'dismissed')),
  raid_id uuid references public.raid_entries (id) on delete set null,
  decided_by uuid not null default auth.uid() references public.profiles (id),
  decided_at timestamptz not null default now(),
  unique (project_id, signal_key)
);
create index ai_suggestion_decisions_project_idx on public.ai_suggestion_decisions (project_id);

alter table public.ai_settings enable row level security;
alter table public.ai_suggestion_decisions enable row level security;

create policy ai_settings_select on public.ai_settings for select to authenticated
  using (project_id in (select public.visible_project_ids()));
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check ((select public.can_manage_project(project_id)));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using ((select public.can_manage_project(project_id)))
  with check ((select public.can_manage_project(project_id)));

create policy ai_decisions_select on public.ai_suggestion_decisions for select to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()));
create policy ai_decisions_insert on public.ai_suggestion_decisions for insert to authenticated
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids())
              and decided_by = (select auth.uid()));

-- Who and when come from the session, never from the client.
create or replace function public.tg_ai_settings_stamp()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'AI settings cannot move to another project' using errcode = '42501';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;

create trigger ai_settings_stamp before insert or update on public.ai_settings
  for each row execute function public.tg_ai_settings_stamp();

create or replace function public.tg_ai_settings_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled)
     or (tg_op = 'INSERT' and not new.enabled) then
    return null;  -- no change: nothing to audit
  end if;
  if auth.uid() is null then
    return null;  -- seed / maintenance as the owner: no signed-in user to attribute it to
  end if;
  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
  values (auth.uid(), new.project_id, 'ai.settings.update', 'project', new.project_id::text,
          jsonb_build_object('aiEnabled', case when tg_op = 'UPDATE' then old.enabled else false end),
          jsonb_build_object('aiEnabled', new.enabled));
  return null;
end $$;

create trigger ai_settings_audit after insert or update on public.ai_settings
  for each row execute function public.tg_ai_settings_audit();

grant select, insert, update on public.ai_settings to authenticated;
grant select, insert on public.ai_suggestion_decisions to authenticated;
grant all on public.ai_settings, public.ai_suggestion_decisions to service_role;
