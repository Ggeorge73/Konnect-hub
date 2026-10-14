import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import {
  completeOnboarding,
  createClientOrg,
  getDemoProject,
  getWorkspace,
  invite,
  listInvites,
  memoryWorkspaceStore,
  resetOnboarding,
  updateWorkspace,
  workspaceStore,
} from './onboarding';
import { isPostgresEnabled } from './index';
import { ForbiddenError, ValidationError } from './errors';

const as = (id: string) => sessionFor(id);
const admin = () => as('u_admin');
beforeEach(() => resetDb());

describe('workspace settings (demo store)', () => {
  it('the demo seed is already onboarded so nobody is redirected', async () => {
    expect((await getWorkspace(as('u_lead'))).onboardedAt).toBeTruthy();
  });

  it('Admins rename the workspace and set a logo; everyone can read it; others cannot write', async () => {
    const w = await updateWorkspace(admin(), {
      name: 'Konnector Delivery',
      logoUrl: '/clients/peachtree.svg',
    });
    expect(w).toMatchObject({
      name: 'Konnector Delivery',
      logoUrl: '/clients/peachtree.svg',
      updatedBy: 'u_admin',
    });
    expect((await getWorkspace(as('u_sponsor'))).name).toBe('Konnector Delivery');
    await expect(updateWorkspace(as('u_lead'), { name: 'Nope', logoUrl: '' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(db().audit.some((a) => a.action === 'workspace.update')).toBe(true);
  });

  it('reset and complete toggle onboardedAt, both audited', async () => {
    expect((await resetOnboarding(admin())).onboardedAt).toBeNull();
    expect((await completeOnboarding(admin())).onboardedAt).toBeTruthy();
    expect(db().audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['workspace.onboarding_reset', 'workspace.onboarded']),
    );
    await expect(resetOnboarding(as('u_lead'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('first client', () => {
  it('creates a client org a project can use; duplicates are refused', async () => {
    const org = await createClientOrg(admin(), { name: 'Acme Health', logoUrl: '' });
    expect(org).toMatchObject({ name: 'Acme Health', type: 'client' });
    const p = await memoryRepo.createProject(admin(), {
      name: 'Acme EHR',
      key: 'ACME',
      clientOrgId: org.id,
      leadId: 'u_admin',
      startDate: '2026-10-12',
      targetDate: '2027-01-29',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 0,
      description: '',
      templateId: 'kdf-hybrid',
    });
    expect(db().phases.filter((ph) => ph.projectId === p.id)).toHaveLength(5);
    await expect(createClientOrg(admin(), { name: 'acme health', logoUrl: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(createClientOrg(as('u_lead'), { name: 'Other', logoUrl: '' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('invites', () => {
  it('records pending invites, skipping existing people and duplicates', async () => {
    const created = await invite(admin(), {
      emails: 'new@konnectortech.com, LARA@konnectortech.com\nnew@konnectortech.com',
      role: 'associate',
    });
    expect(created.map((i) => [i.email, i.role, i.status])).toEqual([
      ['new@konnectortech.com', 'associate', 'pending'],
    ]);
    expect(await invite(admin(), { emails: 'new@konnectortech.com' })).toEqual([]);
    expect(await listInvites(admin())).toHaveLength(1);
    await expect(listInvites(as('u_lead'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('demo project', () => {
  it('is found until the one-click delete soft-deletes it (audited)', async () => {
    expect(await getDemoProject(admin())).toEqual({ key: 'EHR', name: 'Demo — Clinic EHR Go-Live' });
    await memoryRepo.deleteDemoProject(admin());
    expect(await getDemoProject(admin())).toBeNull();
    expect(db().projects.find((p) => p.key === 'EHR')!.deletedAt).toBeTruthy();
    expect(db().audit.some((a) => a.action === 'project.soft_delete')).toBe(true);
    expect((await memoryRepo.listProjects(as('u_sponsor'))).some((p) => p.key === 'EHR')).toBe(false);
  });

  it('only Admins see the demo-project card data', async () => {
    await expect(getDemoProject(as('u_dev'))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('store selection', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses the demo store in demo mode and Postgres exactly when getRepo() does', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('KH_DATA', '');
    expect(workspaceStore()).toBe(memoryWorkspaceStore);
    vi.stubEnv('DATABASE_URL', 'postgres://kh@127.0.0.1:1/none');
    vi.stubEnv('KH_DATA', 'postgres');
    expect(isPostgresEnabled()).toBe(true);
    expect(workspaceStore()).not.toBe(memoryWorkspaceStore);
    expect(workspaceStore()).toBe(workspaceStore());
  });
});
