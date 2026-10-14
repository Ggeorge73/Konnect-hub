-- Team Shield (KH-47 SEC-03): security review hardening.
--
-- * audit_log_stamp: an entry written directly by a signed-in user (role `authenticated`, which is
--   also what PostgREST uses with the public anon key + the user's JWT) gets the server time in
--   `at`. Before this, a user could backdate or future-date the entries the
--   `audit_log_insert` policy lets them append for themselves, so the log's order could be forged.
--   Rows written by security-definer functions and triggers (gate and acceptance decisions,
--   permission changes) and by the owner (seed, restores) keep the time they were given.
-- * The "View as client" preview start/stop entries (`preview.start`, `preview.stop`) are ordinary
--   self-attributed audit rows and stay Admin-only to read (audit_log_select).

create or replace function public.audit_log_stamp()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.at := now();
  end if;
  return new;
end $$;

drop trigger if exists audit_log_stamp on public.audit_log;
create trigger audit_log_stamp before insert on public.audit_log
  for each row execute function public.audit_log_stamp();

revoke all on function public.audit_log_stamp() from public, anon, authenticated;
