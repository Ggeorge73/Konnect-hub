import type { Organization, Session } from '../domain/types';
import {
  canManageWorkspace,
  clientOrgSchema,
  inviteSchema,
  newInvites,
  splitEmails,
  workspaceSchema,
  type Invite,
  type WorkspaceSettings,
} from '../domain/onboarding';
import type { WorkspaceStore } from './onboarding';
import { asUser, audit, getSql, toOrg, type Row, type Sql } from './postgres';
import { ForbiddenError, ValidationError } from './errors';
import { DEMO_PROJECT_KEY } from './seed';

const toSettings = (r: Row | undefined): WorkspaceSettings => ({
  name: r?.name ?? '',
  logoUrl: r?.logo_url ?? null,
  onboardedAt: r?.onboarded_at ?? null,
  updatedAt: r?.updated_at ?? null,
  updatedBy: r?.updated_by ?? null,
});

const toInvite = (r: Row): Invite => ({
  id: r.id,
  email: r.email,
  role: r.role,
  status: r.status,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
});

/** Admin-only guard shared by both stores (friendlier than an RLS denial). */
export function requireAdmin(s: Session) {
  if (!canManageWorkspace(s.user)) throw new ForbiddenError('Only Admins can change workspace settings.');
}

/**
 * Workspace settings and invites on Postgres + RLS (0010_portal_onboarding.sql). RLS is the real
 * enforcer (Admin-only writes); `requireAdmin` runs first only for the friendlier message.
 */
export function createPostgresWorkspaceStore(sql: Sql): WorkspaceStore {
  const admin = async (s: Session) => requireAdmin(s);
  const setOnboarded =
    (on: boolean): WorkspaceStore['completeOnboarding'] =>
    async (s) => {
      await admin(s);
      return asUser(sql, s.user.id, async (tx) => {
        const [r] = await tx`
          update public.workspace_settings
          set onboarded_at = case when ${on}::boolean then now() end, updated_at = now(), updated_by = ${s.user.id}
          where id returning *`;
        await audit(
          tx,
          s,
          null,
          on ? 'workspace.onboarded' : 'workspace.onboarding_reset',
          'workspace',
          'workspace',
        );
        return toSettings(r);
      });
    };

  return {
    async getWorkspace(s) {
      return asUser(sql, s.user.id, async (tx) => {
        const [r] = await tx`select * from public.workspace_settings where id`;
        return toSettings(r);
      });
    },

    async updateWorkspace(s, input) {
      await admin(s);
      const v = workspaceSchema.parse(input);
      return asUser(sql, s.user.id, async (tx) => {
        const [r] = await tx`
          update public.workspace_settings
          set name = ${v.name}, logo_url = ${v.logoUrl || null}, updated_at = now(), updated_by = ${s.user.id}
          where id returning *`;
        await audit(tx, s, null, 'workspace.update', 'workspace', 'workspace', undefined, { name: v.name });
        return toSettings(r);
      });
    },

    async createClientOrg(s, input): Promise<Organization> {
      await admin(s);
      const v = clientOrgSchema.parse(input);
      return asUser(sql, s.user.id, async (tx) => {
        const [dupe] = await tx`select 1 from public.organizations where lower(name) = lower(${v.name})`;
        if (dupe) throw new ValidationError(`A client called ${v.name} already exists.`);
        const [r] = await tx`
          insert into public.organizations (name, type, logo_url)
          values (${v.name}, 'client', ${v.logoUrl || null}) returning *`;
        await audit(tx, s, null, 'organization.create', 'organization', r.id, undefined, { name: v.name });
        return toOrg(r);
      });
    },

    async listInvites(s) {
      await admin(s);
      return asUser(sql, s.user.id, async (tx) =>
        (await tx`select * from public.invites order by created_at desc`).map(toInvite),
      );
    },

    async invite(s, input) {
      await admin(s);
      const v = inviteSchema.parse(input);
      return asUser(sql, s.user.id, async (tx) => {
        const [profiles, invites] = await Promise.all([
          tx`select email from public.profiles`,
          tx`select email from public.invites`,
        ]);
        const fresh = newInvites(splitEmails(v.emails), {
          profiles: profiles.map((p) => ({ email: String(p.email) })),
          invites: invites.map((i) => ({ email: String(i.email) })),
        });
        const out: Invite[] = [];
        for (const email of fresh) {
          const [r] = await tx`
            insert into public.invites (email, role, invited_by)
            values (${email}, ${v.role ?? 'team_member'}, ${s.user.id}) returning *`;
          await audit(tx, s, null, 'invite.create', 'invite', r.id, undefined, { email, role: r.role });
          out.push(toInvite(r));
        }
        return out;
      });
    },

    completeOnboarding: setOnboarded(true),
    resetOnboarding: setOnboarded(false),

    async getDemoProject(s) {
      await admin(s);
      return asUser(sql, s.user.id, async (tx) => {
        const [p] = await tx`
          select key, name from public.projects where key = ${DEMO_PROJECT_KEY} and deleted_at is null`;
        return p ? { key: String(p.key), name: String(p.name) } : null;
      });
    },
  };
}

let store: WorkspaceStore | undefined;
export const postgresWorkspaceStore = (): WorkspaceStore =>
  (store ??= createPostgresWorkspaceStore(getSql()));
