-- Client requests (KH-49). Clients cannot insert work_items directly (work_items_insert is
-- internal-only), so client sponsors and members raise requests through this function.
-- It always creates a shared `client_request` in the backlog, reported by the caller.
create or replace function public.create_client_request(
  p_project_id uuid,
  p_title text,
  p_description text default '',
  p_priority public.priority default 'medium')
returns public.work_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.current_profile_role();
  v_item public.work_items;
begin
  if v_role is null or v_role not in ('client_sponsor', 'client_member') then
    raise exception 'Only client sponsors and members can raise requests.' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Title is required.' using errcode = '22023';
  end if;

  insert into public.work_items (project_id, type, title, description, status, priority, reporter_id,
    visibility, position)
  values (p_project_id, 'client_request', btrim(p_title), coalesce(p_description, ''), 'backlog',
    coalesce(p_priority, 'medium'), auth.uid(), 'shared',
    (select coalesce(max(position), 0) + 1000 from public.work_items where project_id = p_project_id))
  returning * into v_item;

  insert into public.activity (project_id, item_id, actor_id, action, detail, visibility)
  values (v_item.project_id, v_item.id, auth.uid(), 'item.created', v_item.key || ' created', 'shared');

  return v_item;
end $$;

revoke execute on function public.create_client_request(uuid, text, text, public.priority) from public, anon;
grant execute on function public.create_client_request(uuid, text, text, public.priority) to authenticated, service_role;
