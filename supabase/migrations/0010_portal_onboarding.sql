-- Team Portal: workspace settings for the first-run wizard and pending team invites (ONB-01).
-- Mirrors lib/domain/onboarding.ts and lib/data/onboarding{,-postgres}.ts.
-- Client logos use organizations.logo_url (0001); Admins already write organizations.

-- ---------------------------------------------------------------------------
-- workspace_settings: exactly one row. Everyone signed in reads it (name and logo brand the app,
-- including the client portal); only Admins change it.
-- ---------------------------------------------------------------------------
create table public.workspace_settings (
  id boolean primary key default true check (id),
  name text not null default '' check (char_length(name) <= 80),
  logo_url text check (logo_url is null or (char_length(logo_url) <= 200000 and (
    logo_url ~* '^data:image/(png|jpe?g|gif|webp|svg\+xml);base64,'
    or logo_url ~ '^/[^/]'
    or logo_url ~* '^https://'))),
  onboarded_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

-- An existing workspace (it already has clients) counts as onboarded; a fresh one runs the wizard.
insert into public.workspace_settings (id, onboarded_at)
select true, case when exists (select 1 from public.organizations where type = 'client') then now() end;

alter table public.workspace_settings enable row level security;

create policy workspace_settings_select on public.workspace_settings for select to authenticated
  using (true);
create policy workspace_settings_admin_update on public.workspace_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- No insert/delete policies: the single row is created here and never removed.

-- ---------------------------------------------------------------------------
-- invites: pending team invites recorded by the wizard. Konnector roles only (clients are
-- invited per project by their Lead). Admin only: emails of people not yet in the workspace.
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.user_role not null default 'team_member'
    check (role in ('delivery_lead', 'team_member', 'associate')),
  status text not null default 'pending' check (status in ('pending')),
  invited_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint invites_email_unique unique (email)
);

alter table public.invites enable row level security;

create policy invites_admin on public.invites for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()) and invited_by = (select auth.uid()));

grant select, update on public.workspace_settings to authenticated;
grant select, insert, update, delete on public.invites to authenticated;
grant all on public.workspace_settings, public.invites to service_role;
