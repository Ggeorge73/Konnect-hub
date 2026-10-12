import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectionOptions,
  createPostgresRepo,
  createSql,
  loadSession,
  textArray,
  type Sql,
} from './postgres';
import { runRepoContract, type Persona } from './contract';
import { SEED_PROFILE_UUID } from './seed-ids';

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

  it('loads sessions as the user, with ids from the fixed seed uuids', async () => {
    await reset();
    const s = await sessionFor('u_sponsor');
    expect(s.user.id).toBe('b0000000-0000-4000-8000-000000000006');
    expect(s.user.role).toBe('client_sponsor');
    expect(s.org.name).toBe('Peachtree Clinic Group');
    expect(s.user.costRate).toBeUndefined();
    expect((await sessionFor('u_admin')).user.costRate).toBe(120);
  });
});
