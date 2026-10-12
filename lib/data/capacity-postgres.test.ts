import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresRepo, createSql, loadSession, type Sql } from './postgres';
import { createPostgresCapacityStore } from './capacity-postgres';
import { runCapacityContract } from './contract-capacity';
import type { Persona } from './contract';
import { SEED_PROFILE_UUID } from './seed-ids';

/**
 * Runs the capacity contract against Postgres + RLS. Skipped unless TEST_DATABASE_URL points at a
 * database with auth-stub, migrations and seed.sql applied (supabase/tests/run-contract-tests.sh).
 * Each scenario gets a fresh copy of that database (CREATE DATABASE … TEMPLATE).
 */
const url = process.env.TEST_DATABASE_URL;

const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

describe.skipIf(!url)('postgres capacity store (TEST_DATABASE_URL)', () => {
  const seeded = url ? dbName(url) : '';
  const clone = `kh_capacity_run_${process.pid}`;
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

  runCapacityContract(
    'postgres',
    () => ({ repo: createPostgresRepo(sql!), capacity: createPostgresCapacityStore(sql!) }),
    sessionFor,
    reset,
  );

  it('refused attempts survive the rollback in audit_log', async () => {
    await reset();
    const capacity = createPostgresCapacityStore(sql!);
    const repo = createPostgresRepo(sql!);
    const lead = await sessionFor('u_lead');
    const assoc = SEED_PROFILE_UUID.u_assoc;
    const rvb = 'c0000000-0000-4000-8000-000000000002';
    await expect(
      capacity.assignMember(lead, 'RVB', { userId: assoc, projectRole: 'Integration', allocationPct: 50 }),
    ).rejects.toThrow('not a U.S. person');
    await expect(repo.updateItem(lead, 'RVB-1', { assigneeId: assoc })).rejects.toThrow('not a U.S. person');
    await expect(capacity.setRestricted(lead, 'EHR', true)).rejects.toThrow('Sam Rivera');
    const rows = await sql!`select actor_id, project_id, after from public.audit_log
                            where action = 'security.restricted_refused' order by id`;
    const after = (r: (typeof rows)[number]) => (typeof r.after === 'string' ? JSON.parse(r.after) : r.after);
    expect(rows.map((r) => after(r).via ?? 'flag')).toEqual(['project_member', 'assignee', 'flag']);
    expect(rows[0].actor_id).toBe(lead.user.id);
    expect(rows[1].project_id).toBe(rvb);
    const [{ n }] = await sql!`select count(*)::int as n from public.project_members
                               where user_id = ${assoc} and project_id = ${rvb}`;
    expect(n).toBe(0);
  });
});
