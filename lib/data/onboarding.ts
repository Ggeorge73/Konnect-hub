import type { Organization, Session } from '../domain/types';
import {
  clientOrgSchema,
  inviteSchema,
  newInvites,
  splitEmails,
  workspaceSchema,
  type ClientOrgInput,
  type Invite,
  type InviteInput,
  type WorkspaceInput,
  type WorkspaceSettings,
} from '../domain/onboarding';
import { db } from './memory';
import { DEMO_PROJECT_KEY } from './seed';
import { isPostgresEnabled } from './index';
import { postgresWorkspaceStore, requireAdmin } from './onboarding-postgres';
import { newId } from './ids';
import { ValidationError } from './errors';
import { writeAudit } from './gates';

/**
 * Workspace settings, first-run onboarding and pending invites (ONB-01). `WorkspaceStore` has
 * two implementations, picked like getRepo(): the demo store below and the Postgres + RLS store in
 * onboarding-postgres.ts (supabase/migrations/0010_portal_onboarding.sql). Admin only, except
 * `getWorkspace`, which everyone reads for branding.
 */
export interface WorkspaceStore {
  getWorkspace(s: Session): Promise<WorkspaceSettings>;
  updateWorkspace(s: Session, input: WorkspaceInput): Promise<WorkspaceSettings>;
  createClientOrg(s: Session, input: ClientOrgInput): Promise<Organization>;
  listInvites(s: Session): Promise<Invite[]>;
  /** Records pending invites; skips people who already have an account or an invite. */
  invite(s: Session, input: InviteInput): Promise<Invite[]>;
  completeOnboarding(s: Session): Promise<WorkspaceSettings>;
  /** Clears onboardedAt so the wizard runs again (demo-mode test hook and "Re-run setup"). */
  resetOnboarding(s: Session): Promise<WorkspaceSettings>;
  /** The seeded demo project if it has not been deleted. */
  getDemoProject(s: Session): Promise<{ key: string; name: string } | null>;
}

const now = () => new Date().toISOString();

const ws = () => db().workspace;

export const memoryWorkspaceStore: WorkspaceStore = {
  async getWorkspace() {
    return { ...ws().settings };
  },

  async updateWorkspace(s, input) {
    requireAdmin(s);
    const v = workspaceSchema.parse(input);
    const before = { ...ws().settings };
    Object.assign(ws().settings, {
      name: v.name,
      logoUrl: v.logoUrl || null,
      updatedAt: now(),
      updatedBy: s.user.id,
    });
    writeAudit(s, 'workspace.update', 'workspace', 'workspace', before, { ...ws().settings });
    return { ...ws().settings };
  },

  async createClientOrg(s, input) {
    requireAdmin(s);
    const v = clientOrgSchema.parse(input);
    const d = db();
    if (d.orgs.some((o) => o.name.toLowerCase() === v.name.toLowerCase()))
      throw new ValidationError(`A client called ${v.name} already exists.`);
    const org: Organization = { id: newId('org'), name: v.name, type: 'client' };
    if (v.logoUrl) org.logoUrl = v.logoUrl;
    d.orgs.push(org);
    writeAudit(s, 'organization.create', 'organization', org.id, undefined, org);
    return org;
  },

  async listInvites(s) {
    requireAdmin(s);
    return [...ws().invites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async invite(s, input) {
    requireAdmin(s);
    const v = inviteSchema.parse(input);
    const fresh = newInvites(splitEmails(v.emails), { profiles: db().profiles, invites: ws().invites });
    const at = now();
    const created = fresh.map((email): Invite => ({
      id: newId('inv'),
      email,
      role: v.role ?? 'team_member',
      status: 'pending',
      invitedBy: s.user.id,
      createdAt: at,
    }));
    ws().invites.push(...created);
    for (const i of created) writeAudit(s, 'invite.create', 'invite', i.id, undefined, i);
    return created;
  },

  async completeOnboarding(s) {
    requireAdmin(s);
    const before = ws().settings.onboardedAt;
    Object.assign(ws().settings, { onboardedAt: now(), updatedAt: now(), updatedBy: s.user.id });
    writeAudit(s, 'workspace.onboarded', 'workspace', 'workspace', before, ws().settings.onboardedAt);
    return { ...ws().settings };
  },

  async resetOnboarding(s) {
    requireAdmin(s);
    const before = ws().settings.onboardedAt;
    Object.assign(ws().settings, { onboardedAt: null, updatedAt: now(), updatedBy: s.user.id });
    writeAudit(s, 'workspace.onboarding_reset', 'workspace', 'workspace', before, null);
    return { ...ws().settings };
  },

  async getDemoProject(s) {
    requireAdmin(s);
    const p = db().projects.find((x) => x.key === DEMO_PROJECT_KEY && !x.deletedAt);
    return p ? { key: p.key, name: p.name } : null;
  },
};

/** The active store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const workspaceStore = (): WorkspaceStore =>
  isPostgresEnabled() ? postgresWorkspaceStore() : memoryWorkspaceStore;

export const getWorkspace: WorkspaceStore['getWorkspace'] = (...a) => workspaceStore().getWorkspace(...a);
export const updateWorkspace: WorkspaceStore['updateWorkspace'] = (...a) =>
  workspaceStore().updateWorkspace(...a);
export const createClientOrg: WorkspaceStore['createClientOrg'] = (...a) =>
  workspaceStore().createClientOrg(...a);
export const listInvites: WorkspaceStore['listInvites'] = (...a) => workspaceStore().listInvites(...a);
export const invite: WorkspaceStore['invite'] = (...a) => workspaceStore().invite(...a);
export const completeOnboarding: WorkspaceStore['completeOnboarding'] = (...a) =>
  workspaceStore().completeOnboarding(...a);
export const resetOnboarding: WorkspaceStore['resetOnboarding'] = (...a) =>
  workspaceStore().resetOnboarding(...a);
export const getDemoProject: WorkspaceStore['getDemoProject'] = (...a) =>
  workspaceStore().getDemoProject(...a);
