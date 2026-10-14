import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresRepo, createSql, loadSession, type Sql } from './postgres';
import { createPostgresWorkspaceStore } from './onboarding-postgres';
import { SEED_PROFILE_UUID } from './seed-ids';
import type { Session } from '../domain/types';
import { getApprovalInbox } from './portal';

/**
 * Workspace settings, invites and the portal inbox on Postgres + RLS. Skipped unless
 * TEST_DATABASE_URL is set; run with `bash supabase/tests/run-contract-tests.sh
 * lib/data/onboarding-postgres.test.ts`. Works on a private clone of the seeded database.
 */
const url = process.env.TEST_DATABASE_URL;
const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

describe.skipIf(!url)('workspace store on postgres (TEST_DATABASE_URL)', () => {
  const clone = `kh_onboarding_run_${process.pid}`;
  let admin: Sql;
  let sql: Sql;
  const as = async (p: keyof typeof SEED_PROFILE_UUID): Promise<Session> =>
    (await loadSession(sql, SEED_PROFILE_UUID[p]))!;

  beforeAll(async () => {
    const seeded = dbName(url!);
    admin = createSql(withDb(url!, seeded === 'postgres' ? 'template1' : 'postgres'), 1);
    await admin.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin.unsafe(`create database "${clone}" template "${seeded}"`);
    sql = createSql(withDb(url!, clone), 4);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin?.end({ timeout: 5 });
  });

  it('runs the wizard end to end as the Admin, and refuses everyone else', async () => {
    const store = createPostgresWorkspaceStore(sql);
    const a = await as('u_admin');
    expect((await store.getWorkspace(await as('u_sponsor'))).name).toBe('');
    expect((await store.updateWorkspace(a, { name: 'Konnector Delivery', logoUrl: '' })).name).toBe(
      'Konnector Delivery',
    );
    const org = await store.createClientOrg(a, { name: 'Acme Health', logoUrl: '/clients/acme.svg' });
    expect(org).toMatchObject({ name: 'Acme Health', type: 'client', logoUrl: '/clients/acme.svg' });
    const project = await createPostgresRepo(sql).createProject(a, {
      name: 'Acme EHR',
      key: 'ACME',
      clientOrgId: org.id,
      leadId: a.user.id,
      startDate: '2026-10-12',
      targetDate: '2027-01-29',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 0,
      description: '',
      templateId: 'kdf-hybrid',
    });
    expect(project.key).toBe('ACME');
    const invited = await store.invite(a, { emails: 'new@konnectortech.com, lara@konnectortech.com' });
    expect(invited.map((i) => i.email)).toEqual(['new@konnectortech.com']);
    expect((await store.completeOnboarding(a)).onboardedAt).toBeTruthy();
    expect((await store.resetOnboarding(a)).onboardedAt).toBeNull();
    expect(await store.getDemoProject(a)).toMatchObject({ key: 'EHR' });

    const lead = await as('u_lead');
    await expect(store.updateWorkspace(lead, { name: 'Nope', logoUrl: '' })).rejects.toThrow();
    await expect(store.invite(lead, { emails: 'x@konnectortech.com' })).rejects.toThrow();
  });

  it('the inbox respects RLS: Riverbend sees no Peachtree rows', async () => {
    const prev = { DATABASE_URL: process.env.DATABASE_URL, KH_DATA: process.env.KH_DATA };
    process.env.DATABASE_URL = withDb(url!, clone);
    process.env.KH_DATA = 'postgres';
    try {
      const sponsor = await getApprovalInbox(await as('u_sponsor'));
      expect(sponsor.some((e) => e.projectKey === 'EHR')).toBe(true);
      const r = await getApprovalInbox(await as('u_rsponsor'));
      expect(r.every((e) => e.projectKey === 'RVB')).toBe(true);
    } finally {
      process.env.DATABASE_URL = prev.DATABASE_URL;
      process.env.KH_DATA = prev.KH_DATA;
    }
  });
});
