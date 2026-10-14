import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  connectionOptions,
  createPostgresRepo,
  createSql,
  findProject,
  inServiceScope,
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
import { createPostgresInsightStore } from './insight-postgres';
import { createPostgresMetricsStore } from './metrics-postgres';
import { createPostgresReportStore } from './reports-postgres';
import { createPostgresSignalStore, pgNotify } from './notify-postgres';
import { SEED_PROFILE_UUID } from './seed-ids';
import { clearOutbox, outbox } from '../email/send';
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
      insight: createPostgresInsightStore(sql!),
      metrics: createPostgresMetricsStore(sql!),
      reports: createPostgresReportStore(sql!),
      signal: createPostgresSignalStore(sql!),
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

  it('Postgres writes notify in the same transaction, tagged with the content visibility; email after commit', async () => {
    await reset();
    clearOutbox();
    const repo = createPostgresRepo(sql!);
    const dev = await sessionFor('u_dev');
    const team = await sessionFor('u_team');
    const item = await repo.createItem(await sessionFor('u_lead'), {
      projectId: 'EHR',
      type: 'task',
      title: 'Postgres notify',
      visibility: 'shared',
    });
    await repo.addComment(dev, { itemId: item.key, body: '@Tiara internal note', visibility: 'internal' });
    await repo.addComment(dev, { itemId: item.key, body: '@Grace shared note', visibility: 'shared' });
    const rows = await sql!`select u.email, n.visibility from public.notifications n
                            join public.profiles u on u.id = n.user_id
                            where n.kind = 'mention' and n.link like ${'%' + item.key}
                            order by n.created_at`;
    expect(rows.map((r) => [r.email, r.visibility])).toEqual([
      ['tiara@konnectortech.com', 'internal'],
      ['grace@peachtreeclinic.example', 'shared'],
    ]);
    expect(outbox().map((m) => m.to)).toEqual(['tiara@konnectortech.com', 'grace@peachtreeclinic.example']);

    // A write that fails after notifying leaves neither the notification nor the email behind.
    clearOutbox();
    const p = await asUser(sql!, dev.user.id, (tx) => findProject(tx, 'EHR'));
    await expect(
      asUser(sql!, dev.user.id, async (tx) => {
        await pgNotify(tx, {
          kind: 'mention',
          projectId: p.id,
          recipients: [team.user.id],
          title: 'rolled back',
          href: '/x',
          visibility: 'internal',
        });
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(await sql!`select 1 from public.notifications where title = 'rolled back'`).toHaveLength(0);
    expect(outbox()).toEqual([]);
    // The 0008 trigger is the backstop: an internal notification to a client never lands.
    await expect(
      asUser(sql!, dev.user.id, (tx) =>
        inServiceScope(
          tx,
          (tx) => tx`insert into public.notifications (user_id, project_id, kind, title, visibility)
                     values (${SEED_PROFILE_UUID.u_sponsor}, ${p.id}, 'mention', 'x', 'internal')`,
        ),
      ),
    ).rejects.toThrow('internal notifications cannot be sent to client users');
  });

  it('EVM inputs are server-only: AC from approved time x cost rate, EV from deliverable weights', async () => {
    await reset();
    const insight = createPostgresInsightStore(sql!);
    const lead = await sessionFor('u_lead');
    const dev = await sessionFor('u_dev');
    const p = await asUser(sql!, lead.user.id, (tx) => findProject(tx, 'EHR'));
    await expect(
      asUser(sql!, dev.user.id, (tx) => tx`select public.project_evm_inputs(${p.id})`),
    ).rejects.toThrow();
    const [{ ac }] = await sql!`select round(sum(t.hours * r.cost_rate) * 100)::bigint as ac
                                from public.time_entries t join public.profile_rates r on r.profile_id = t.user_id
                                where t.project_id = ${p.id} and t.status = 'approved'`;
    // Only approved time counts (KH-37); the seeded entries are drafts.
    const [{ n }] = await sql!`select count(*)::int as n from public.time_entries
                               where project_id = ${p.id} and status <> 'approved'`;
    expect(n).toBeGreaterThan(0);
    const d = await insight.getDashboard(lead, 'EHR', new Date('2026-10-12T12:00:00Z'));
    expect(d.evm!.ac).toBe(Number(ac));
    expect(d.evm!.bac).toBe(48_000_000);

    await sql!`update public.deliverables set ev_weight = 1 where project_id = ${p.id}`;
    expect((await insight.getDashboard(lead, 'EHR')).evm!.percentComplete).toBe(0);
    await sql!`update public.deliverables set status = 'accepted' where project_id = ${p.id}`;
    expect((await insight.getDashboard(lead, 'EHR')).evm!.percentComplete).toBe(100);
    // The team member gets the same ratios without any money.
    const ratios = await insight.getDashboard(dev, 'EHR');
    expect([ratios.evmAccess, ratios.evm!.bac, ratios.evm!.percentComplete]).toEqual(['ratios', null, 100]);
  });

  it('stores audit before/after as JSON values, not JSON strings', async () => {
    await reset();
    const repo = createPostgresRepo(sql!);
    await repo.updateItem(await sessionFor('u_lead'), 'EHR-12', { visibility: 'shared' });
    const [row] = await sql!`select jsonb_typeof(before) as b, before #>> '{}' as v from public.audit_log
                             where action = 'visibility.change' order by at desc limit 1`;
    expect(row).toEqual({ b: 'string', v: 'internal' });
    const lead = await sessionFor('u_lead');
    const gates = createPostgresGateStore(sql!);
    const phase = (await gates.getGates(lead, 'EHR')).phases.find((p) => p.gate === 4)!;
    await gates.addCriterion(lead, 'EHR', phase.id, 'Cutover rehearsal signed off');
    const [r2] = await sql!`select jsonb_typeof(after) as t, after ->> 'text' as text from public.audit_log
                            where action = 'gate_criterion.create' order by at desc limit 1`;
    expect(r2).toEqual({ t: 'object', text: 'Cutover rehearsal signed off' });
  });
});
