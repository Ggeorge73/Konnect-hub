-- Executive dashboard, earned value and portfolio (KH-25 DASH-01, KH-26 EVM-01, KH-28 DASH-02).
-- Mirrors lib/domain/{evm,dashboard}.ts and lib/data/insight.ts.
--
-- * projects.share_budget: the Lead lets client users see budget/EVM on the portal dashboard.
--   project_financials stays admin/lead-only otherwise (section 4 of rls.test.sql).
-- * deliverables.ev_weight: optional EV weight of a deliverable (EV = Σ weight × % complete × BAC).
-- * A RAG change always needs a reason, and RAG / budget-sharing changes are always audited,
--   whichever path (API or SQL) makes them.
-- * Actual cost (AC) is not stored here: Sprint 4 computes it from approved time_entries ×
--   profile_rates. The demo store seeds actuals in lib/data/seed-insight.ts until then.

alter table public.projects add column share_budget boolean not null default false;

alter table public.deliverables
  add column ev_weight numeric(8, 2) check (ev_weight is null or ev_weight > 0);

-- Clients of the project's own org read its budget once the Lead shares it. Internal roles keep
-- the canSeeFinancials rule (admin / delivery lead) whether or not it is shared.
create or replace function public.can_see_shared_budget(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_client()
     and public.can_see_project(p_project_id)
     and coalesce((select share_budget from public.projects where id = p_project_id), false)
$$;

create policy project_financials_shared_select on public.project_financials for select to authenticated
  using (public.can_see_shared_budget(project_id));

create or replace function public.tg_projects_dashboard_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.rag is distinct from old.rag or new.rag_reason is distinct from old.rag_reason then
    if nullif(btrim(coalesce(new.rag_reason, '')), '') is null then
      raise exception 'A reason is required to set the RAG status.' using errcode = 'check_violation';
    end if;
    new.rag_reason := btrim(new.rag_reason);
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
    values (auth.uid(), new.id, 'project.rag_override', 'project', new.id::text,
            jsonb_build_object('rag', old.rag, 'ragReason', old.rag_reason),
            jsonb_build_object('rag', new.rag, 'ragReason', new.rag_reason));
  end if;
  if new.share_budget is distinct from old.share_budget then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
    values (auth.uid(), new.id, 'dashboard.share_budget', 'project', new.id::text,
            jsonb_build_object('shareBudget', old.share_budget),
            jsonb_build_object('shareBudget', new.share_budget));
  end if;
  return new;
end $$;

create trigger projects_dashboard_audit
  before update of rag, rag_reason, share_budget on public.projects
  for each row execute function public.tg_projects_dashboard_audit();

-- Privileges for the new functions (0001 granted on the functions that existed then).
revoke execute on function public.can_see_shared_budget(uuid) from public, anon;
revoke execute on function public.tg_projects_dashboard_audit() from public, anon;
grant execute on function public.can_see_shared_budget(uuid) to authenticated, service_role;
