import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  connectionOptions,
  createPostgresRepo,
  createSql,
  loadSession,
  markMfaEnabled,
  textArray,
  type Sql,
} from './postgres';
import { runRepoContract, type Persona } from './contract';
import { runDomainContracts } from './contract-domains';
import { createPostgresRaidStore } from './raid-postgres';
import { createPostgresSprintStore } from './sprints-postgres';
import { createPostgresGateStore } from './gates-postgres';
import { createPostgresDeliverableStore } from './deliverables-postgres';
import { createPostgresAcceptanceRecordStore } from './acceptance-record-postgres';
import { SEED_PROFILE_UUID } from './seed-ids';
import { runLedgerContract } from './contract-ledger';
import { createPostgresLedgerStore } from './ledger-postgres';
import { createPostgresAuditStore } from './audit-postgres';

/**
 * Runs the Repo contract against Postgres + RLS. Skipped unless TEST_DATABASE_URL points at a
 * database with auth-stub, migrations and seed.sql applied (supabase/tests/run-contract-tests.sh).
 * Each scenario gets a fresh copy of that database (CREATE DATABASE … TEMPLATE), so the role in
 * the URL needs CREATEDB and must be able to `set role authenticated`.
 */
const url = process.env.TEST_DATABASE_URL;

const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

describe('postgres connection helpers', () => {
  it('turns libpq socket URLs into postgres.js options', () => {
    expect(connectionOptions('postgresql://postgres@/kh?host=/tmp/x&port=54329')).toEqual({
      url: 'postgresql://postgres@localhost:54329/kh',
      host: '/tmp/x',
      port: 54329,
    });
    expect(connectionOptions('postgres://u:p@db.example:6543/postgres?sslmode=require')).toEqual({
      url: 'postgres://u:p@db.example:6543/postgres?sslmode=require',
    });
  });

  it('builds text[] literals with quoting', () => {
    expect(textArray([])).toBe('{}');
    expect(textArray(['a', 'b "c"', 'd\\e'])).toBe('{"a","b \\"c\\"","d\\\\e"}');
  });
});

describe.skipIf(!url)('postgres repo (TEST_DATABASE_URL)', () => {
  const seeded = url ? dbName(url) : '';
  const clone = `kh_contract_run_${process.pid}`;
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

  runRepoContract('postgres', () => createPostgresRepo(sql!), sessionFor, reset);
  runDomainContracts(
    'postgres',
    () => ({
      repo: createPostgresRepo(sql!),
      raid: createPostgresRaidStore(sql!),
      sprints: createPostgresSprintStore(sql!),
      gates: createPostgresGateStore(sql!),
      deliverables: createPostgresDeliverableStore(sql!),
      acceptance: createPostgresAcceptanceRecordStore(sql!),
    }),
    sessionFor,
    reset,
  );
  runLedgerContract(
    'postgres',
    () => ({
      repo: createPostgresRepo(sql!),
      ledger: createPostgresLedgerStore(sql!),
      audit: createPostgresAuditStore(sql!),
    }),
    sessionFor,
    reset,
  );

  it('loads sessions as the user, with ids from the fixed seed uuids', async () => {
    await reset();
    const s = await sessionFor('u_sponsor');
    expect(s.user.id).toBe('b0000000-0000-4000-8000-000000000006');
    expect(s.user.role).toBe('client_sponsor');
    expect(s.org.name).toBe('Peachtree Clinic Group');
    expect(s.user.costRate).toBeUndefined();
    expect((await sessionFor('u_admin')).user.costRate).toBe(120);
  });

  it('records a verified re-auth server-side before the decision; users cannot record one', async () => {
    await reset();
    const lead = await sessionFor('u_lead');
    const sponsor = await sessionFor('u_sponsor');
    const gates = createPostgresGateStore(sql!);
    const phase = (await gates.getGates(lead, 'EHR')).phases.find((p) => p.gate === 3)!;
    const review = await gates.requestReview(lead, 'EHR', { phaseId: phase.id, overrideNote: 'Friday demo' });
    // record_reauth is not executable by signed-in users: no forging a re-auth through the API.
    await expect(
      asUser(sql!, sponsor.user.id, (tx) => tx`select public.record_reauth(${sponsor.user.id}::uuid, now())`),
    ).rejects.toThrow();
    const count = async () =>
      Number(
        (await sql!`select count(*) as n from public.reauth_events where user_id = ${sponsor.user.id}`)[0].n,
      );
    expect(await count()).toBe(0);
    const at = new Date().toISOString();
    await gates.decideGate(sponsor, review.id, { decision: 'approved' }, { reauthAt: at, ip: 'not-an-ip' });
    expect(await count()).toBe(1);
    const [row] = await sql!`select at, decided_by, ip from public.reauth_events e
                             join public.gate_reviews g on g.id = ${review.id} where e.user_id = ${sponsor.user.id}`;
    expect(new Date(row.at).toISOString()).toBe(at);
    expect(row.decided_by).toBe(sponsor.user.id);
    expect(row.ip).toBeNull();
  });

  it('marks MFA enabled for the caller only, and only at aal2', async () => {
    await reset();
    const member = await sessionFor('u_cmember');
    const mfa = async (id: string) =>
      (await sql!`select mfa_enabled from public.profiles where id = ${id}`)[0].mfa_enabled as boolean;
    expect(await mfa(member.user.id)).toBe(false);
    await expect(markMfaEnabled(sql!, member.user.id, 'aal1')).rejects.toThrow('authenticator');
    expect(await mfa(member.user.id)).toBe(false);
    expect(await markMfaEnabled(sql!, member.user.id, 'aal2')).toBe(true);
    expect(await mfa(member.user.id)).toBe(true);
    expect((await sessionFor('u_cmember')).user.mfaEnabled).toBe(true);
    expect(await mfa((await sessionFor('u_cviewer')).user.id)).toBe(false);
    // Idempotent; audited once.
    expect(await markMfaEnabled(sql!, member.user.id, 'aal2')).toBe(true);
    const [{ n }] = await sql!`select count(*)::int as n from public.audit_log
                               where action = 'profile.mfa_enabled' and entity_id = ${member.user.id}`;
    expect(n).toBe(1);
  });
});
