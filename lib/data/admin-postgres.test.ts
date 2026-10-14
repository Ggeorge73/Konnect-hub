import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresRepo, createSql, loadSession, type Sql } from './postgres';
import { runAdminContract } from './contract-admin';
import { createPostgresAdminStore } from './admin-postgres';
import { createPostgresTemplateStore } from './templates-admin-postgres';
import { createPostgresCustomFieldStore } from './custom-fields-postgres';
import { createPostgresAttachmentStore } from './attachments-postgres';
import { createPostgresAuditStore } from './audit-postgres';
import { createPostgresRaidStore } from './raid-postgres';
import type { Persona } from './contract';
import { SEED_PROFILE_UUID } from './seed-ids';

/**
 * Runs the admin console + attachments contract against Postgres + RLS. Skipped unless
 * TEST_DATABASE_URL points at a database with auth-stub, migrations and seed.sql applied
 * (supabase/tests/run-contract-tests.sh). Each scenario gets a fresh copy of that database.
 */
const url = process.env.TEST_DATABASE_URL;

const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

describe.skipIf(!url)('postgres admin console + attachments (TEST_DATABASE_URL)', () => {
  const seeded = url ? dbName(url) : '';
  const clone = `kh_admin_run_${process.pid}`;
  let admin: Sql;
  let sql: Sql | undefined;

  beforeAll(() => {
    if (!seeded) throw new Error('TEST_DATABASE_URL must name a database');
    admin = createSql(withDb(url!, seeded === 'postgres' ? 'template1' : 'postgres'), 1);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
    await admin?.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin?.end({ timeout: 5 });
  });

  const reset = async () => {
    await sql?.end({ timeout: 5 });
    await admin.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin.unsafe(`create database "${clone}" template "${seeded}"`);
    sql = createSql(withDb(url!, clone), 4);
  };

  const sessionFor = async (p: Persona) => {
    const s = await loadSession(sql!, SEED_PROFILE_UUID[p]);
    if (!s) throw new Error(`no profile for ${p}`);
    return s;
  };

  runAdminContract(
    'postgres',
    () => ({
      repo: createPostgresRepo(sql!),
      admin: createPostgresAdminStore(sql!),
      templates: createPostgresTemplateStore(sql!),
      fields: createPostgresCustomFieldStore(sql!),
      attachments: createPostgresAttachmentStore(sql!),
      audit: createPostgresAuditStore(sql!),
      raid: createPostgresRaidStore(sql!),
    }),
    sessionFor,
    reset,
  );

  it('a deactivated user gets no session and no rows; reactivation restores both', async () => {
    await reset();
    const store = createPostgresAdminStore(sql!);
    const a = await sessionFor('u_admin');
    const sponsor = SEED_PROFILE_UUID.u_sponsor;
    await store.setActive(a, sponsor, false);
    expect(await loadSession(sql!, sponsor)).toBeNull();
    const rows = await sql!.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claim.sub', ${sponsor}, true)`;
      return tx`select id from public.projects`;
    });
    expect(rows).toHaveLength(0);
    await store.setActive(a, sponsor, true);
    expect((await loadSession(sql!, sponsor))?.user.role).toBe('client_sponsor');
  });

  it('a lead cannot change roles or deactivate anyone, even straight in SQL', async () => {
    await reset();
    const lead = SEED_PROFILE_UUID.u_lead;
    const team = SEED_PROFILE_UUID.u_team;
    const attempt = (stmt: string) =>
      sql!.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub', ${lead}, true)`;
        return tx.unsafe(stmt);
      });
    await attempt(`update public.profiles set role = 'admin' where id = '${team}'`);
    await expect(
      attempt(`update public.profiles set deactivated_at = now() where id = '${lead}'`),
    ).rejects.toThrow();
    const [r] = await sql!`select role, deactivated_at from public.profiles where id = ${team}`;
    expect(r).toMatchObject({ role: 'team_member', deactivated_at: null });
  });
});
