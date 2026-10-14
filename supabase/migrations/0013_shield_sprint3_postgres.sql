-- Team Shield (KH-51 FND-06): Postgres data path for the Sprint 3 domains (Insight, Pulse, Signal).
-- Mirrors lib/data/{insight,metrics,reports,notify}-postgres.ts.
--
-- * user_can_see_project(): canSeeProject for an arbitrary user, so the notification dispatcher can
--   drop recipients who cannot see the project (lib/domain/permissions.ts canSeeProject).
-- * project_evm_inputs(): BAC, the EV baseline (deliverables with ev_weight) and actual cost
--   (time_entries x profile_rates). It reads financials and cost rates, so it is server-only: the
--   app checks project visibility as the user first, then masks money per evmAccess().
-- * audit_log_dashboard_select: the project Lead (not only Admins) reads the RAG-override and
--   budget-sharing audit trail of a project they manage (listDashboardAudit).
-- * status_report_drafts.rag_reason: the internal RAG reason. status_reports.rag_reason becomes the
--   client copy at publish, like status_reports.sections.

-- ---------------------------------------------------------------------------
-- canSeeProject for another user (mirrors watcher_can_see_item at project level). Server-only.
-- ---------------------------------------------------------------------------
create or replace function public.user_can_see_project(p_user uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.projects p
    join public.profiles u on u.id = p_user
    where p.id = p_project
      and case
        when p.deleted_at is not null then u.role = 'admin'
        when u.role = 'admin' then true
        when u.role in ('client_sponsor', 'client_member', 'client_viewer') then p.client_org_id = u.org_id
        when p.restricted and not u.us_person then false
        when u.role = 'delivery_lead' and p.lead_id = u.id then true
        else exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = u.id)
      end)
$$;

revoke execute on function public.user_can_see_project(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_can_see_project(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- EVM inputs for one project (KH-26). Money in integer cents.
--   bac_cents   project_financials.bac
--   milestones  deliverables with an ev_weight: planned from the phase start (or project start)
--               to the deliverable due date (or phase end, or project target); 100% once accepted
--   actuals     cost per day: approved time_entries.hours x profile_rates.cost_rate (0012 adds
--               the approval lifecycle; draft, submitted and rejected time never counts)
-- ---------------------------------------------------------------------------
create or replace function public.project_evm_inputs(p_project uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'bac_cents', coalesce((select round(f.bac * 100) from public.project_financials f
                           where f.project_id = p_project), 0),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id,
               'name', d.name,
               'weight', d.ev_weight,
               'start_date', coalesce(ph.start_date, p.start_date, current_date),
               'due_date', coalesce(d.due_date, ph.end_date, p.target_date, current_date),
               'percent_complete', case when d.status = 'accepted' then 100 else 0 end)
             order by coalesce(d.due_date, ph.end_date, p.target_date), d.id)
      from public.deliverables d
      join public.projects p on p.id = d.project_id
      left join public.phases ph on ph.id = d.phase_id
      where d.project_id = p_project and d.ev_weight is not null), '[]'::jsonb),
    'actuals', coalesce((
      select jsonb_agg(jsonb_build_object('date', a.entry_date, 'amount_cents', a.cents) order by a.entry_date)
      from (
        select t.entry_date, round(sum(t.hours * coalesce(r.cost_rate, 0)) * 100) as cents
        from public.time_entries t
        left join public.profile_rates r on r.profile_id = t.user_id
        where t.project_id = p_project and t.status = 'approved'
        group by t.entry_date
      ) a), '[]'::jsonb))
$$;

revoke execute on function public.project_evm_inputs(uuid) from public, anon, authenticated;
grant execute on function public.project_evm_inputs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Dashboard audit trail for the project's Lead (Admins already read every audit row).
-- ---------------------------------------------------------------------------
create policy audit_log_dashboard_select on public.audit_log for select to authenticated using (
  entity = 'project'
  and project_id is not null
  and entity_id = project_id::text
  and (action like 'project.rag%' or action like 'dashboard.%')
  and public.can_manage_project(project_id));

-- ---------------------------------------------------------------------------
-- Status reports: the internal RAG reason lives with the internal working copy.
-- ---------------------------------------------------------------------------
alter table public.status_report_drafts add column rag_reason text;
update public.status_report_drafts d set rag_reason = r.rag_reason
  from public.status_reports r where r.id = d.report_id;

-- ---------------------------------------------------------------------------
-- RAG override / budget-sharing audit: also record the client IP the app passes for this
-- transaction (`kh.client_ip`, set with set_config(..., true) after validating it), as the demo
-- store does. Same rules as 0006 otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.tg_projects_dashboard_audit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ip inet;
begin
  begin
    v_ip := nullif(current_setting('kh.client_ip', true), '')::inet;
  exception when others then
    v_ip := null;
  end;
  if new.rag is distinct from old.rag or new.rag_reason is distinct from old.rag_reason then
    if nullif(btrim(coalesce(new.rag_reason, '')), '') is null then
      raise exception 'A reason is required to set the RAG status.' using errcode = 'check_violation';
    end if;
    new.rag_reason := btrim(new.rag_reason);
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after, ip)
    values (auth.uid(), new.id, 'project.rag_override', 'project', new.id::text,
            jsonb_build_object('rag', old.rag, 'ragReason', old.rag_reason),
            jsonb_build_object('rag', new.rag, 'ragReason', new.rag_reason), v_ip);
  end if;
  if new.share_budget is distinct from old.share_budget then
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after, ip)
    values (auth.uid(), new.id, 'dashboard.share_budget', 'project', new.id::text,
            jsonb_build_object('shareBudget', old.share_budget),
            jsonb_build_object('shareBudget', new.share_budget), v_ip);
  end if;
  return new;
end $$;

revoke execute on function public.tg_projects_dashboard_audit() from public, anon;
