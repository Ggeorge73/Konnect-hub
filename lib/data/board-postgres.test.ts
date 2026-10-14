import { afterAll, beforeAll, describe } from 'vitest';
import { createPostgresRepo, createSql, loadSession, type Sql } from './postgres';
import { createPostgresBoardPage } from './board-postgres';
import { runBoardContract } from './contract-board';
import type { Persona } from './contract';
import { SEED_PROFILE_UUID } from './seed-ids';

/**
 * Runs the board paging contract (KH-46) against Postgres + RLS. Skipped unless
 * TEST_DATABASE_URL points at a database with auth-stub, migrations and seed.sql applied
 * (supabase/tests/run-contract-tests.sh). Each scenario gets a fresh copy of that database.
 */
const url = process.env.TEST_DATABASE_URL;

const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

describe.skipIf(!url)('postgres board page (TEST_DATABASE_URL)', () => {
  const seeded = url ? dbName(url) : '';
  const clone = `kh_board_run_${process.pid}`;
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

  runBoardContract(
    'postgres',
    () => ({ repo: createPostgresRepo(sql!), board: createPostgresBoardPage(sql!) }),
    sessionFor,
    reset,
  );
});
