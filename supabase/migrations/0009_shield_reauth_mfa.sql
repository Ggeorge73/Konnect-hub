-- Team Shield (KH-50): server-side re-auth recording and the MFA-enrolled flag.

-- ---------------------------------------------------------------------------
-- record_reauth: the app server writes a reauth_events row after it has verified the user's
-- signed re-auth cookie (lib/reauth.ts). Clients have no insert policy on reauth_events, and
-- this function is NOT executable by anon or authenticated, so a signed-in user can never
-- forge a re-auth through the API. The server runs it as its own login role at the start of
-- the decision transaction, before switching to `authenticated` (lib/data/postgres.ts asUser).
-- ---------------------------------------------------------------------------
create or replace function public.record_reauth(p_user_id uuid, p_at timestamptz)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user_id is null or p_at is null then
    raise exception 'user and time are required' using errcode = '22023';
  end if;
  -- Only a fresh re-auth is worth recording; never one from the future.
  if p_at > now() + interval '1 minute' or p_at <= now() - interval '15 minutes' then
    return false;
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  insert into public.reauth_events (user_id, at)
  select p_user_id, p_at
   where not exists (select 1 from public.reauth_events where user_id = p_user_id and at = p_at);
  return true;
end $$;

revoke execute on function public.record_reauth(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_reauth(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- mark_mfa_enabled: after a successful TOTP verify the session is at aal2; the signed-in user
-- flips their own profiles.mfa_enabled. profiles_guard stops users changing that flag directly,
-- so this SECURITY DEFINER function is the only self-service path. It touches only the caller's
-- row (auth.uid()) and needs an aal2 JWT, so it cannot be called before the second factor.
-- ---------------------------------------------------------------------------
create or replace function public.mark_mfa_enabled()
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_aal text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '');
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_aal <> 'aal2' then
    raise exception 'Verify your authenticator code first.' using errcode = '42501';
  end if;
  update public.profiles set mfa_enabled = true where id = v_uid and not mfa_enabled;
  if found then
    insert into public.audit_log (actor_id, action, entity, entity_id, after)
    values (v_uid, 'profile.mfa_enabled', 'profile', v_uid::text, jsonb_build_object('mfa_enabled', true));
  end if;
  return exists (select 1 from public.profiles where id = v_uid and mfa_enabled);
end $$;

revoke execute on function public.mark_mfa_enabled() from public, anon;
grant execute on function public.mark_mfa_enabled() to authenticated, service_role;
