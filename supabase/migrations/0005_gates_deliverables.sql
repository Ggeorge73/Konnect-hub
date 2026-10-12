-- Gate review flow (GATE-01/02), deliverable acceptance (DLV-01) and the Acceptance Record (PDF-01).
-- Mirrors lib/domain/gates.ts, lib/domain/deliverables.ts and lib/data/{gates,deliverables}.ts.
-- Transitions run in SECURITY DEFINER functions so the rules cannot be bypassed from the API.

-- ---------------------------------------------------------------------------
-- Re-auth events: written by the server (service_role) after the user re-verifies.
-- Gate and acceptance decisions require one in the last 15 minutes.
-- ---------------------------------------------------------------------------
create table public.reauth_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index reauth_events_user_idx on public.reauth_events (user_id, at desc);

create or replace function public.has_fresh_reauth()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.reauth_events
                 where user_id = auth.uid() and at > now() - interval '15 minutes' and at <= now() + interval '1 minute')
$$;

-- ---------------------------------------------------------------------------
-- gate_reviews: a pending request (Lead) that the Client Sponsor later decides.
-- The pack holds no budget and no internal deliverables/risks: those are read live
-- through RLS (deliverables, raid_entries) and gate_review_budgets below.
-- ---------------------------------------------------------------------------
create type public.gate_review_status as enum ('pending', 'decided');

alter table public.gate_reviews
  add column status public.gate_review_status not null default 'decided',
  add column requested_by uuid references public.profiles (id),
  add column requested_at timestamptz,
  add column override_note text,
  add column budget_shared boolean not null default false,
  add column pack jsonb not null default '{}'::jsonb,
  add column condition_item_keys text[] not null default '{}',
  alter column decision drop not null,
  alter column decided_by drop not null,
  alter column decided_at drop not null,
  add constraint gate_reviews_decided_complete
    check (status = 'pending' or (decision is not null and decided_by is not null and decided_at is not null)),
  add constraint gate_reviews_pending_open
    check (status = 'decided' or (decision is null and decided_by is null and decided_at is null));
create unique index gate_reviews_one_pending on public.gate_reviews (phase_id) where status = 'pending';

-- Budget status snapshot for a review. Internal unless the Lead shared it with the client.
create table public.gate_review_budgets (
  review_id uuid primary key references public.gate_reviews (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  bac numeric(14, 2) not null default 0,
  percent_complete numeric(5, 2) not null default 0
);

-- Direct decisions must carry a fresh re-auth; normally decisions go through decide_gate().
drop policy gate_reviews_insert on public.gate_reviews;
create policy gate_reviews_insert on public.gate_reviews for insert to authenticated with check (
  (select public.current_profile_role()) = 'client_sponsor'
  and status = 'decided'
  and decided_by = (select auth.uid())
  and (select public.has_fresh_reauth())
  and project_id in (select public.visible_project_ids()));

alter table public.reauth_events enable row level security;
alter table public.gate_review_budgets enable row level security;

create policy reauth_events_own on public.reauth_events for select to authenticated
  using (user_id = (select auth.uid()));

create policy gate_review_budgets_select on public.gate_review_budgets for select to authenticated using (
  public.can_see_financials(project_id)
  or ((select public.is_client())
      and project_id in (select public.visible_project_ids())
      and exists (select 1 from public.gate_reviews g where g.id = review_id and g.budget_shared)));

-- ---------------------------------------------------------------------------
-- deliverables: owner + criteria accepted by the client one by one.
-- ---------------------------------------------------------------------------
alter table public.deliverables
  add column owner_id uuid references public.profiles (id),
  add column created_by uuid references public.profiles (id),
  add column submitted_at timestamptz;

create table public.deliverable_criteria (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  deliverable_id uuid not null,
  text text not null check (length(text) between 1 and 500),
  status public.ac_status not null default 'pending',
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  ip inet,
  position integer not null default 0,
  foreign key (deliverable_id, project_id) references public.deliverables (id, project_id) on delete cascade
);
create index deliverable_criteria_deliverable_idx on public.deliverable_criteria (deliverable_id, position);
create index deliverable_criteria_project_idx on public.deliverable_criteria (project_id);

alter table public.deliverable_criteria enable row level security;
-- Readable when the parent deliverable is (clients: shared deliverables only).
create policy deliverable_criteria_select on public.deliverable_criteria for select to authenticated using (
  project_id in (select public.visible_project_ids())
  and exists (select 1 from public.deliverables d where d.id = deliverable_id));
-- Internal staff write; clients decide only through decide_deliverable_criterion().
create policy deliverable_criteria_internal_write on public.deliverable_criteria for all to authenticated
  using ((select public.is_internal()) and project_id in (select public.visible_project_ids()))
  with check ((select public.is_internal()) and project_id in (select public.visible_project_ids()));

-- ---------------------------------------------------------------------------
-- request_gate_review: the Lead marks the working phase ready. Open criteria block
-- the request unless an override note is given (and recorded).
-- ---------------------------------------------------------------------------
create or replace function public.request_gate_review(
  p_phase_id uuid,
  p_override_note text default null,
  p_summary text default null,
  p_share_budget boolean default false)
returns public.gate_reviews
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_phase public.phases;
  v_review public.gate_reviews;
  v_open int;
  v_total int;
  v_done_items int;
  v_all_items int;
  v_note text := nullif(btrim(p_override_note), '');
begin
  select * into v_phase from public.phases where id = p_phase_id for update;
  if not found or not public.can_see_project(v_phase.project_id) then
    raise exception 'phase not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_project(v_phase.project_id) then
    raise exception 'Only the project Lead or an Admin can manage gates.' using errcode = '42501';
  end if;
  if v_phase.status not in ('active', 'rejected') then
    raise exception 'Only the active phase can be marked ready for gate review.' using errcode = '22023';
  end if;
  if exists (select 1 from public.phases p where p.project_id = v_phase.project_id and p.gate < v_phase.gate
             and p.status not in ('approved', 'approved_with_conditions')) then
    raise exception 'Earlier gates must be approved first.' using errcode = '22023';
  end if;
  select count(*) filter (where not done), count(*) into v_open, v_total
    from public.gate_criteria where phase_id = v_phase.id;
  if v_open > 0 and v_note is null then
    raise exception '% exit criteria are not complete. Tick them or add an override note.', v_open
      using errcode = '22023';
  end if;

  insert into public.gate_reviews (project_id, phase_id, status, decided_at, requested_by, requested_at,
                                   override_note, budget_shared, pack)
  values (v_phase.project_id, v_phase.id, 'pending', null, auth.uid(), now(), case when v_open > 0 then v_note end,
          coalesce(p_share_budget, false),
          jsonb_build_object(
            'summary', coalesce(nullif(btrim(p_summary), ''),
                                format('Gate %s · %s: %s of %s exit criteria complete.', v_phase.gate, v_phase.name,
                                       v_total - v_open, v_total)),
            'completedCriteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text,
                                             'doneBy', c.done_by, 'doneAt', c.done_at) order by c.position)
                                           from public.gate_criteria c where c.phase_id = v_phase.id and c.done), '[]'),
            'overriddenCriteria', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text)
                                              order by c.position)
                                            from public.gate_criteria c where c.phase_id = v_phase.id and not c.done), '[]')))
  returning * into v_review;

  select count(*) filter (where status in ('done', 'accepted')), count(*) into v_done_items, v_all_items
    from public.work_items
   where project_id = v_phase.project_id and deleted_at is null and type not in ('epic', 'feature');
  insert into public.gate_review_budgets (review_id, project_id, bac, percent_complete)
  select v_review.id, v_phase.project_id, coalesce(f.bac, 0),
         case when v_all_items = 0 then 0 else round(100.0 * v_done_items / v_all_items) end
    from (select 1) x left join public.project_financials f on f.project_id = v_phase.project_id;

  update public.phases set status = 'ready_for_review' where id = v_phase.id;

  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
  values (auth.uid(), v_phase.project_id, 'gate.request_review', 'gate_review', v_review.id::text,
          jsonb_build_object('phase_status', v_phase.status),
          jsonb_build_object('phase_status', 'ready_for_review', 'override_note', v_review.override_note,
                             'budget_shared', v_review.budget_shared));
  insert into public.activity (project_id, actor_id, action, detail, visibility)
  values (v_phase.project_id, auth.uid(), 'gate.review_requested',
          format('Gate %s · %s marked ready for gate review%s', v_phase.gate, v_phase.name,
                 case when v_open > 0 then format(' (%s open criteria overridden)', v_open) else '' end),
          'shared');
  return v_review;
end $$;

-- ---------------------------------------------------------------------------
-- decide_gate: the Client Sponsor of the project's org approves, approves with
-- conditions (each becomes a shared `gate-condition` task) or rejects (reason required).
-- Needs a fresh re-auth; records name, time and IP; unlocks the next phase.
-- ---------------------------------------------------------------------------
create or replace function public.decide_gate(
  p_review_id uuid,
  p_decision public.gate_decision,
  p_conditions text[] default null,
  p_reason text default null,
  p_ip inet default null)
returns public.gate_reviews
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_review public.gate_reviews;
  v_phase public.phases;
  v_next public.phases;
  v_conditions text[] := array(select btrim(c) from unnest(coalesce(p_conditions, '{}')) c where btrim(c) <> '');
  v_reason text := nullif(btrim(p_reason), '');
  v_keys text[] := '{}';
  v_cond text;
  v_key text;
begin
  select * into v_review from public.gate_reviews where id = p_review_id for update;
  if not found or not public.can_see_project(v_review.project_id) then
    raise exception 'gate review not found' using errcode = 'P0002';
  end if;
  if public.current_profile_role() is distinct from 'client_sponsor' then
    raise exception 'Only the client''s Sponsor can approve or reject a gate.' using errcode = '42501';
  end if;
  if v_review.status <> 'pending' then
    raise exception 'This gate review has already been decided.' using errcode = '22023';
  end if;
  if not public.has_fresh_reauth() then
    raise exception 'reauth_required' using errcode = '28000';
  end if;
  if p_decision = 'approved_with_conditions' and cardinality(v_conditions) = 0 then
    raise exception 'Add at least one condition to approve with conditions.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'A reason is required to reject a gate.' using errcode = '22023';
  end if;

  select * into v_phase from public.phases where id = v_review.phase_id for update;
  select * into v_next from public.phases
   where project_id = v_phase.project_id and gate > v_phase.gate order by gate limit 1;

  if p_decision = 'rejected' then
    update public.phases set status = 'active' where id = v_phase.id;
  else
    update public.phases set status = p_decision::text::public.phase_status, end_date = current_date
     where id = v_phase.id;
    if v_next.id is not null and v_next.status = 'not_started' then
      update public.phases set status = 'active', start_date = current_date where id = v_next.id;
    end if;
    foreach v_cond in array v_conditions loop
      insert into public.work_items (project_id, type, title, description, status, priority, assignee_id,
                                     reporter_id, phase_id, labels, visibility)
      select v_phase.project_id, 'task', left(v_cond, 255),
             format('Condition of gate %s approval: %s', v_phase.gate, v_cond), 'ready', 'high', p.lead_id,
             auth.uid(), coalesce(v_next.id, v_phase.id), array['gate-condition'], 'shared'
        from public.projects p where p.id = v_phase.project_id
      returning key into v_key;
      v_keys := v_keys || v_key;
    end loop;
  end if;

  update public.gate_reviews
     set status = 'decided', decision = p_decision,
         conditions = nullif(array_to_string(v_conditions, E'\n'), ''),
         reason = v_reason, decided_by = auth.uid(), decided_at = now(), ip = p_ip,
         condition_item_keys = v_keys
   where id = v_review.id
  returning * into v_review;

  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after, ip)
  values (auth.uid(), v_phase.project_id, 'gate.decide', 'gate_review', v_review.id::text,
          jsonb_build_object('phase_status', v_phase.status),
          jsonb_build_object('decision', p_decision, 'conditions', to_jsonb(v_conditions), 'reason', v_reason,
                             'condition_item_keys', to_jsonb(v_keys)),
          p_ip);
  insert into public.activity (project_id, actor_id, action, detail, visibility)
  values (v_phase.project_id, auth.uid(),
          case when p_decision = 'rejected' then 'gate.rejected' else 'gate.approved' end,
          case when p_decision = 'rejected'
               then format('%s gate rejected: %s. Phase returned to active.', v_phase.name, v_reason)
               else format('%s gate %s', v_phase.name, replace(p_decision::text, '_', ' ')) end,
          'shared');
  return v_review;
end $$;

-- ---------------------------------------------------------------------------
-- decide_deliverable_criterion: a client sponsor/member accepts or rejects one criterion.
-- Roll-up: all accepted => accepted; any rejected => rejected, and the linked items are
-- reopened (In Progress) as a system action.
-- ---------------------------------------------------------------------------
create or replace function public.decide_deliverable_criterion(
  p_criterion_id uuid,
  p_status public.ac_status,
  p_note text default null,
  p_ip inet default null)
returns public.deliverables
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.current_profile_role();
  v_crit public.deliverable_criteria;
  v_del public.deliverables;
  v_prev public.deliverable_status;
  v_new public.deliverable_status;
  v_item record;
begin
  if p_status not in ('accepted', 'rejected') then
    raise exception 'Decide accepted or rejected.' using errcode = '22023';
  end if;
  select * into v_crit from public.deliverable_criteria where id = p_criterion_id for update;
  if not found then raise exception 'criterion not found' using errcode = 'P0002'; end if;
  select * into v_del from public.deliverables where id = v_crit.deliverable_id for update;
  if not public.can_see_project(v_del.project_id) or v_del.visibility <> 'shared' or v_del.status = 'draft' then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  if v_role is null or v_role not in ('client_sponsor', 'client_member') then
    raise exception 'Only the client''s Sponsor or Members can accept deliverables.' using errcode = '42501';
  end if;
  if v_del.status <> 'submitted' then
    raise exception 'This deliverable is not awaiting acceptance.' using errcode = '22023';
  end if;
  if not public.has_fresh_reauth() then
    raise exception 'reauth_required' using errcode = '28000';
  end if;

  update public.deliverable_criteria
     set status = p_status, note = nullif(btrim(p_note), ''), decided_by = auth.uid(), decided_at = now(), ip = p_ip
   where id = v_crit.id;

  v_prev := v_del.status;
  select case when bool_or(status = 'rejected') then 'rejected'
              when count(*) > 0 and bool_and(status = 'accepted') then 'accepted'
              else 'submitted' end::public.deliverable_status
    into v_new from public.deliverable_criteria where deliverable_id = v_del.id;
  update public.deliverables
     set status = v_new,
         decided_by = case when v_new <> 'submitted' then auth.uid() else decided_by end,
         decided_at = case when v_new <> 'submitted' then now() else decided_at end
   where id = v_del.id
  returning * into v_del;

  insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after, ip)
  values (auth.uid(), v_del.project_id, 'deliverable.criterion_decide', 'deliverable', v_del.id::text,
          jsonb_build_object('criterion_id', v_crit.id, 'criterion_status', v_crit.status, 'status', v_prev),
          jsonb_build_object('criterion_id', v_crit.id, 'criterion_status', p_status, 'status', v_new,
                             'note', nullif(btrim(p_note), '')),
          p_ip);
  insert into public.activity (project_id, actor_id, action, detail, visibility)
  values (v_del.project_id, auth.uid(), 'deliverable.criterion',
          format('"%s" %s on "%s"', v_crit.text, p_status, v_del.name), 'shared');

  if v_new = 'rejected' and v_prev <> 'rejected' then
    for v_item in
      update public.work_items w set status = 'in_progress'
        from public.deliverable_items di
       where di.deliverable_id = v_del.id and w.id = di.item_id
         and w.deleted_at is null and w.status <> 'in_progress'
      returning w.id, w.key, w.visibility
    loop
      insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after)
      values (auth.uid(), v_del.project_id, 'item.system_reopen', 'work_item', v_item.id::text,
              jsonb_build_object('status', 'in_progress', 'deliverable_id', v_del.id));
      insert into public.activity (project_id, item_id, actor_id, action, detail, visibility)
      values (v_del.project_id, v_item.id, auth.uid(), 'item.reopened',
              format('%s reopened: deliverable "%s" was rejected', v_item.key, v_del.name), v_item.visibility);
    end loop;
  end if;
  return v_del;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges for the new objects (0001 granted on the tables that existed then).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.reauth_events, public.gate_review_budgets,
  public.deliverable_criteria to authenticated;
grant all on public.reauth_events, public.gate_review_budgets, public.deliverable_criteria to service_role;
revoke execute on function public.has_fresh_reauth(), public.request_gate_review(uuid, text, text, boolean),
  public.decide_gate(uuid, public.gate_decision, text[], text, inet),
  public.decide_deliverable_criterion(uuid, public.ac_status, text, inet) from public, anon;
grant execute on function public.has_fresh_reauth(), public.request_gate_review(uuid, text, text, boolean),
  public.decide_gate(uuid, public.gate_decision, text[], text, inet),
  public.decide_deliverable_criterion(uuid, public.ac_status, text, inet) to authenticated, service_role;
