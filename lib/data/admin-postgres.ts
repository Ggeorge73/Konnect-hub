import type { Organization, Session } from '../domain/types';
import { adminInviteSchema, nameFromEmail, type AdminInvite, type AdminUser } from '../domain/admin';
import { clientOrgSchema, newInvites, splitEmails, workspaceDisplayName } from '../domain/onboarding';
import type { AdminStore } from './admin';
import { asUser, audit, getSql, isUuid, toOrg, toProfile, type Row, type Sql, type Tx } from './postgres';
import { safeIp } from './gates-postgres';
import { NotFoundError, ValidationError } from './errors';
import { assertDeactivate, assertInviteRole, assertRoleChange, requireAdmin } from './admin-rules';
import { deliverInvite, setAuthBan } from '../email/invite';

const toAdminUser = (r: Row): AdminUser => ({
  ...toProfile(r),
  orgName: r.org_name,
  orgType: r.org_type,
  deactivatedAt: r.deactivated_at ?? null,
});

const toAdminInvite = (r: Row): AdminInvite => ({
  id: r.id,
  email: r.email,
  role: r.role,
  orgId: r.org_id ?? r.internal_org_id,
  status: r.status,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
  lastSentAt: r.last_sent_at ?? null,
  sentCount: Number(r.sent_count ?? 0),
});

/** Passes the validated client IP to the audit_log trigger (0017) for this transaction only. */
export async function withClientIp(tx: Tx, ip?: string) {
  await tx`select set_config('kh.client_ip', ${safeIp(ip) ?? ''}, true)`;
}

/**
 * Users, invites and client orgs on Postgres + RLS (0017_portal_admin_files.sql). RLS and the
 * triggers are the enforcers (Admin-only writes, role/org match, no self lock-out, audit of role
 * changes and deactivations); the guards here run first for friendlier messages.
 */
export function createPostgresAdminStore(sql: Sql): AdminStore {
  const run = <T>(s: Session, ip: string | undefined, fn: (tx: Tx) => Promise<T>) =>
    asUser(sql, s.user.id, async (tx) => {
      await withClientIp(tx, ip);
      return fn(tx);
    });

  async function user(tx: Tx, id: string): Promise<AdminUser> {
    const [r] = isUuid(id)
      ? await tx`
          select p.*, r.cost_rate, o.name as org_name, o.type as org_type
          from public.profiles p
          join public.organizations o on o.id = p.org_id
          left join public.profile_rates r on r.profile_id = p.id
          where p.id = ${id}`
      : [];
    if (!r) throw new NotFoundError('Profile not found');
    return toAdminUser(r);
  }

  async function invites(tx: Tx, id?: string): Promise<AdminInvite[]> {
    const rows = await tx`
      select i.*, (select o.id from public.organizations o where o.type = 'internal' order by o.created_at limit 1)
               as internal_org_id
      from public.invites i
      ${id ? tx`where i.id = ${id}` : tx``}
      order by i.created_at desc`;
    return rows.map(toAdminInvite);
  }

  async function workspaceName(tx: Tx) {
    const [w] = await tx`select name from public.workspace_settings where id`;
    return workspaceDisplayName({ name: w?.name ?? '' });
  }

  async function org(tx: Tx, id: string): Promise<Organization | undefined> {
    if (!isUuid(id)) return undefined;
    const [r] = await tx`select * from public.organizations where id = ${id}`;
    return r ? toOrg(r) : undefined;
  }

  return {
    async listUsers(s) {
      requireAdmin(s);
      return run(s, undefined, async (tx) =>
        (
          await tx`
            select p.*, r.cost_rate, o.name as org_name, o.type as org_type
            from public.profiles p
            join public.organizations o on o.id = p.org_id
            left join public.profile_rates r on r.profile_id = p.id
            order by o.type, p.name`
        ).map(toAdminUser),
      );
    },

    async changeRole(s, userId, role, ip) {
      requireAdmin(s);
      return run(s, ip, async (tx) => {
        const u = await user(tx, userId);
        assertRoleChange(s, u, (await org(tx, u.orgId))!, role);
        if (u.role === role) return u;
        // The 0012 trigger writes `permission.role_change` (with the IP from kh.client_ip).
        await tx`update public.profiles set role = ${role} where id = ${u.id}`;
        return user(tx, u.id);
      });
    },

    async setActive(s, userId, active, ip) {
      requireAdmin(s);
      return run(s, ip, async (tx) => {
        const u = await user(tx, userId);
        assertDeactivate(s, u);
        if (active === !u.deactivatedAt) return u;
        // The 0017 trigger audits `user.deactivate` / `user.reactivate`.
        await tx`
          update public.profiles set deactivated_at = case when ${active}::boolean then null else now() end
          where id = ${u.id}`;
        // With Supabase, also block (or unblock) sign-in at the auth server; a failure rolls back.
        await setAuthBan(u.id, !active);
        return user(tx, u.id);
      });
    },

    async resendUserInvite(s, userId, ip) {
      requireAdmin(s);
      return run(s, ip, async (tx) => {
        const u = await user(tx, userId);
        if (u.deactivatedAt) throw new ValidationError(`Reactivate ${u.name} before sending an invite.`);
        await deliverInvite({
          email: u.email,
          role: u.role,
          orgName: u.orgName,
          workspaceName: await workspaceName(tx),
          resend: true,
        });
        await audit(tx, s, null, 'invite.resend', 'profile', u.id, undefined, { email: u.email });
        return { sentTo: u.email };
      });
    },

    async listInvites(s) {
      requireAdmin(s);
      return run(s, undefined, (tx) => invites(tx));
    },

    async invite(s, input, ip) {
      requireAdmin(s, 'invite people');
      const v = adminInviteSchema.parse(input);
      return run(s, ip, async (tx) => {
        const o = await org(tx, v.orgId);
        assertInviteRole(o, v.role);
        const [profiles, existing] = await Promise.all([
          tx`select email from public.profiles`,
          tx`select email from public.invites`,
        ]);
        const fresh = newInvites(splitEmails(v.emails), {
          profiles: profiles.map((p) => ({ email: String(p.email) })),
          invites: existing.map((i) => ({ email: String(i.email) })),
        });
        const name = await workspaceName(tx);
        const ids: string[] = [];
        for (const email of fresh) {
          const sent = await deliverInvite({ email, role: v.role, orgName: o!.name, workspaceName: name });
          const [r] = await tx`
            insert into public.invites (email, role, org_id, invited_by, status, last_sent_at, sent_count, auth_user_id)
            values (${email}, ${v.role}, ${o!.id}, ${s.user.id}, 'sent', now(), 1, ${sent.authUserId})
            returning id`;
          // Supabase created the auth user: give them their profile now, so the magic link lands
          // them in the right org with the right role (sign-in is invitation-only).
          if (sent.authUserId)
            await tx`
              insert into public.profiles (id, org_id, name, email, role)
              values (${sent.authUserId}, ${o!.id}, ${nameFromEmail(email)}, ${email}, ${v.role})
              on conflict (id) do nothing`;
          await audit(tx, s, null, 'invite.create', 'invite', r.id, undefined, {
            email,
            role: v.role,
            orgId: o!.id,
          });
          ids.push(r.id);
        }
        const all = await invites(tx);
        return ids.map((id) => all.find((i) => i.id === id)!);
      });
    },

    async resendInvite(s, inviteId, ip) {
      requireAdmin(s, 'invite people');
      return run(s, ip, async (tx) => {
        const [inv] = isUuid(inviteId) ? await invites(tx, inviteId) : [];
        if (!inv) throw new NotFoundError('Invite not found');
        const o = await org(tx, inv.orgId);
        await deliverInvite({
          email: inv.email,
          role: inv.role,
          orgName: o?.name ?? '',
          workspaceName: await workspaceName(tx),
          resend: true,
        });
        await tx`
          update public.invites set status = 'sent', last_sent_at = now(), sent_count = sent_count + 1
          where id = ${inv.id}`;
        await audit(tx, s, null, 'invite.resend', 'invite', inv.id, undefined, { email: inv.email });
        return (await invites(tx, inv.id))[0];
      });
    },

    async revokeInvite(s, inviteId, ip) {
      requireAdmin(s, 'invite people');
      return run(s, ip, async (tx) => {
        const [r] = isUuid(inviteId)
          ? await tx`delete from public.invites where id = ${inviteId} returning email, role`
          : [];
        if (!r) throw new NotFoundError('Invite not found');
        await audit(tx, s, null, 'invite.revoke', 'invite', inviteId, { email: r.email, role: r.role });
      });
    },

    async listClientOrgs(s) {
      requireAdmin(s);
      return run(s, undefined, async (tx) =>
        (
          await tx`
            select o.*,
              (select count(*) from public.profiles p where p.org_id = o.id)::int as user_count,
              (select count(*) from public.projects p where p.client_org_id = o.id and p.deleted_at is null)::int
                as project_count
            from public.organizations o where o.type = 'client' order by o.name`
        ).map((r) => ({ ...toOrg(r), userCount: r.user_count, projectCount: r.project_count })),
      );
    },

    async updateClientOrg(s, orgId, input, ip) {
      requireAdmin(s, 'edit clients');
      const v = clientOrgSchema.parse(input);
      return run(s, ip, async (tx) => {
        const before = await org(tx, orgId);
        if (!before || before.type !== 'client') throw new NotFoundError('Client not found');
        const [dupe] = await tx`
          select 1 from public.organizations where lower(name) = lower(${v.name}) and id <> ${before.id}`;
        if (dupe) throw new ValidationError(`A client called ${v.name} already exists.`);
        const [r] = await tx`
          update public.organizations set name = ${v.name}, logo_url = ${v.logoUrl || null}
          where id = ${before.id} returning *`;
        await audit(
          tx,
          s,
          null,
          'organization.update',
          'organization',
          before.id,
          { name: before.name, logoUrl: before.logoUrl ?? null },
          { name: v.name, logoUrl: v.logoUrl || null },
        );
        return toOrg(r);
      });
    },
  };
}

let store: AdminStore | undefined;
export const postgresAdminStore = (): AdminStore => (store ??= createPostgresAdminStore(getSql()));
