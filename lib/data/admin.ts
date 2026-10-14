import type { Organization, Role, Session } from '../domain/types';
import {
  adminInviteSchema,
  type AdminInvite,
  type AdminInviteInput,
  type AdminOrg,
  type AdminUser,
} from '../domain/admin';
import {
  clientOrgSchema,
  newInvites,
  splitEmails,
  workspaceDisplayName,
  type Invite,
} from '../domain/onboarding';
import type { ClientOrgInput } from '../domain/onboarding';
import { db } from './memory';
import { newId } from './ids';
import { NotFoundError, ValidationError } from './errors';
import { writeAudit } from './gates';
import { isPostgresEnabled } from './index';
import { assertDeactivate, assertInviteRole, assertRoleChange, requireAdmin } from './admin-rules';
import { postgresAdminStore } from './admin-postgres';
import { deliverInvite } from '../email/invite';

/**
 * Admin console: users, invites and client orgs (ADM-01, spec 3.11). Admin only, and every change
 * is audited (who, what, when and the client IP). Two implementations picked like getRepo(): the
 * demo store below and the Postgres + RLS store in admin-postgres.ts (0017_portal_admin_files.sql,
 * where role changes and deactivations are also audited by triggers).
 */
export interface AdminStore {
  listUsers(s: Session): Promise<AdminUser[]>;
  /** A permission change: audited as `permission.role_change`. */
  changeRole(s: Session, userId: string, role: Role, ip?: string): Promise<AdminUser>;
  /** Soft deactivation (and reactivation): audited as `user.deactivate` / `user.reactivate`. */
  setActive(s: Session, userId: string, active: boolean, ip?: string): Promise<AdminUser>;
  /** Sends the user a fresh sign-in invite (magic link with Supabase, else an email). */
  resendUserInvite(s: Session, userId: string, ip?: string): Promise<{ sentTo: string }>;
  listInvites(s: Session): Promise<AdminInvite[]>;
  /** Invites people by email with a role and an org; skips anyone already in or invited. */
  invite(s: Session, input: AdminInviteInput, ip?: string): Promise<AdminInvite[]>;
  resendInvite(s: Session, inviteId: string, ip?: string): Promise<AdminInvite>;
  revokeInvite(s: Session, inviteId: string, ip?: string): Promise<void>;
  listClientOrgs(s: Session): Promise<AdminOrg[]>;
  updateClientOrg(s: Session, orgId: string, input: ClientOrgInput, ip?: string): Promise<Organization>;
}

const now = () => new Date().toISOString();

const internalOrgId = () => db().orgs.find((o) => o.type === 'internal')!.id;

function toAdminUser(id: string): AdminUser {
  const d = db();
  const p = d.profiles.find((x) => x.id === id);
  if (!p) throw new NotFoundError('Profile not found');
  const org = d.orgs.find((o) => o.id === p.orgId)!;
  return { ...p, orgName: org.name, orgType: org.type, deactivatedAt: p.deactivatedAt ?? null };
}

const toAdminInvite = (i: Invite): AdminInvite => ({
  id: i.id,
  email: i.email,
  role: i.role,
  orgId: i.orgId ?? internalOrgId(),
  status: i.status,
  invitedBy: i.invitedBy,
  createdAt: i.createdAt,
  lastSentAt: i.lastSentAt ?? null,
  sentCount: i.sentCount ?? 0,
});

const workspaceName = () => workspaceDisplayName(db().workspace.settings);

function findInvite(id: string) {
  const inv = db().workspace.invites.find((i) => i.id === id);
  if (!inv) throw new NotFoundError('Invite not found');
  return inv;
}

function findClientOrg(id: string) {
  const org = db().orgs.find((o) => o.id === id && o.type === 'client');
  if (!org) throw new NotFoundError('Client not found');
  return org;
}

export const memoryAdminStore: AdminStore = {
  async listUsers(s) {
    requireAdmin(s);
    return db()
      .profiles.map((p) => toAdminUser(p.id))
      .sort((a, b) => a.orgType.localeCompare(b.orgType) || a.name.localeCompare(b.name));
  },

  async changeRole(s, userId, role, ip) {
    requireAdmin(s);
    const d = db();
    const user = d.profiles.find((p) => p.id === userId);
    if (!user) throw new NotFoundError('Profile not found');
    assertRoleChange(
      s,
      user,
      d.orgs.find((o) => o.id === user.orgId)!,
      role,
    );
    if (user.role === role) return toAdminUser(user.id);
    const before = user.role;
    user.role = role;
    writeAudit(s, 'permission.role_change', 'profile', user.id, { role: before }, { role }, ip);
    return toAdminUser(user.id);
  },

  async setActive(s, userId, active, ip) {
    requireAdmin(s);
    const user = db().profiles.find((p) => p.id === userId);
    if (!user) throw new NotFoundError('Profile not found');
    assertDeactivate(s, user);
    const before = user.deactivatedAt ?? null;
    if (active === !before) return toAdminUser(user.id);
    user.deactivatedAt = active ? null : now();
    writeAudit(
      s,
      active ? 'user.reactivate' : 'user.deactivate',
      'profile',
      user.id,
      { deactivatedAt: before },
      { deactivatedAt: user.deactivatedAt },
      ip,
    );
    return toAdminUser(user.id);
  },

  async resendUserInvite(s, userId, ip) {
    requireAdmin(s);
    const user = toAdminUser(userId);
    if (user.deactivatedAt) throw new ValidationError(`Reactivate ${user.name} before sending an invite.`);
    await deliverInvite({
      email: user.email,
      role: user.role,
      orgName: user.orgName,
      workspaceName: workspaceName(),
      resend: true,
    });
    writeAudit(s, 'invite.resend', 'profile', user.id, undefined, { email: user.email }, ip);
    return { sentTo: user.email };
  },

  async listInvites(s) {
    requireAdmin(s);
    return db()
      .workspace.invites.map(toAdminInvite)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async invite(s, input, ip) {
    requireAdmin(s, 'invite people');
    const v = adminInviteSchema.parse(input);
    const d = db();
    const org = d.orgs.find((o) => o.id === v.orgId);
    assertInviteRole(org, v.role);
    const fresh = newInvites(splitEmails(v.emails), { profiles: d.profiles, invites: d.workspace.invites });
    const out: AdminInvite[] = [];
    for (const email of fresh) {
      await deliverInvite({ email, role: v.role, orgName: org!.name, workspaceName: workspaceName() });
      const at = now();
      const inv: Invite = {
        id: newId('inv'),
        email,
        role: v.role,
        status: 'sent',
        invitedBy: s.user.id,
        createdAt: at,
        orgId: org!.id,
        lastSentAt: at,
        sentCount: 1,
      };
      d.workspace.invites.push(inv);
      writeAudit(
        s,
        'invite.create',
        'invite',
        inv.id,
        undefined,
        { email, role: v.role, orgId: org!.id },
        ip,
      );
      out.push(toAdminInvite(inv));
    }
    return out;
  },

  async resendInvite(s, inviteId, ip) {
    requireAdmin(s, 'invite people');
    const inv = findInvite(inviteId);
    const org = db().orgs.find((o) => o.id === (inv.orgId ?? internalOrgId()))!;
    await deliverInvite({
      email: inv.email,
      role: inv.role,
      orgName: org.name,
      workspaceName: workspaceName(),
      resend: true,
    });
    Object.assign(inv, { status: 'sent', lastSentAt: now(), sentCount: (inv.sentCount ?? 0) + 1 });
    writeAudit(s, 'invite.resend', 'invite', inv.id, undefined, { email: inv.email }, ip);
    return toAdminInvite(inv);
  },

  async revokeInvite(s, inviteId, ip) {
    requireAdmin(s, 'invite people');
    const inv = findInvite(inviteId);
    const list = db().workspace.invites;
    list.splice(list.indexOf(inv), 1);
    writeAudit(s, 'invite.revoke', 'invite', inv.id, { email: inv.email, role: inv.role }, undefined, ip);
  },

  async listClientOrgs(s) {
    requireAdmin(s);
    const d = db();
    return d.orgs
      .filter((o) => o.type === 'client')
      .map((o) => ({
        ...o,
        userCount: d.profiles.filter((p) => p.orgId === o.id).length,
        projectCount: d.projects.filter((p) => p.clientOrgId === o.id && !p.deletedAt).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async updateClientOrg(s, orgId, input, ip) {
    requireAdmin(s, 'edit clients');
    const v = clientOrgSchema.parse(input);
    const d = db();
    const org = findClientOrg(orgId);
    if (d.orgs.some((o) => o.id !== org.id && o.name.toLowerCase() === v.name.toLowerCase()))
      throw new ValidationError(`A client called ${v.name} already exists.`);
    const before = { ...org };
    org.name = v.name;
    if (v.logoUrl) org.logoUrl = v.logoUrl;
    else delete org.logoUrl;
    writeAudit(
      s,
      'organization.update',
      'organization',
      org.id,
      { name: before.name, logoUrl: before.logoUrl ?? null },
      { name: org.name, logoUrl: org.logoUrl ?? null },
      ip,
    );
    return { ...org };
  },
};

/** The active store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const adminStore = (): AdminStore => (isPostgresEnabled() ? postgresAdminStore() : memoryAdminStore);
