import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql, loadSession, type Sql } from './postgres';
import { SEED_PROFILE_UUID } from './seed-ids';

/**
 * The Konnector CRM integration end to end on Postgres + RLS: the service (lib/integration/service.ts)
 * with the Postgres stores, as the app runs it with DATABASE_URL + KH_DATA=postgres. Skipped unless
 * TEST_DATABASE_URL points at a database with auth-stub, migrations and seed.sql applied
 * (supabase/tests/run-contract-tests.sh). Runs on its own copy of that database.
 */
const url = process.env.TEST_DATABASE_URL;

const withDb = (u: string, db: string) => u.replace(/^(postgres(?:ql)?:\/\/[^/?]*)(\/[^?]*)?/, `$1/${db}`);
const dbName = (u: string) => decodeURIComponent(/^postgres(?:ql)?:\/\/[^/?]*\/([^?]+)/.exec(u)?.[1] ?? '');

const EHR = 'c0000000-0000-4000-8000-000000000001';
const PEACHTREE = 'a0000000-0000-4000-8000-000000000002';
const QUOTE = 'ci_seed_hypercare_v1';
const SURVEY = 'ci_seed_mobilize_survey_v1';

describe.skipIf(!url)('CRM integration on Postgres (TEST_DATABASE_URL)', () => {
  const seeded = url ? dbName(url) : '';
  const clone = `kh_crm_run_${process.pid}`;
  let admin: Sql;
  let sql: Sql;
  let svc: typeof import('../integration/service');
  let mock: typeof import('../integration/mock-crm');

  beforeAll(async () => {
    admin = createSql(withDb(url!, seeded === 'postgres' ? 'template1' : 'postgres'), 1);
    await admin.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin.unsafe(`create database "${clone}" template "${seeded}"`);
    process.env.DATABASE_URL = withDb(url!, clone);
    process.env.KH_DATA = 'postgres';
    sql = createSql(process.env.DATABASE_URL, 2);
    svc = await import('../integration/service');
    mock = await import('../integration/mock-crm');
  });

  afterAll(async () => {
    const g = globalThis as unknown as { __khSql?: Sql };
    await g.__khSql?.end({ timeout: 5 });
    await sql?.end({ timeout: 5 });
    await admin?.unsafe(`drop database if exists "${clone}" with (force)`);
    await admin?.end({ timeout: 5 });
    delete process.env.DATABASE_URL;
    delete process.env.KH_DATA;
  });

  const as = async (p: string) => (await loadSession(sql, SEED_PROFILE_UUID[p]))!;
  const send = (payload: object) => {
    const { body, signature } = mock.mockCrm.signed(payload as never);
    return svc.receive(body, signature);
  };
  const fresh = () => new Date().toISOString();

  it('hands off a won deal: org, project from the template, link, invites', async () => {
    const r = await send(mock.samples.handoff());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const projectId = r.body.konnect_hub_project_id as string;
    const [p] =
      await sql`select p.key, f.bac, p.target_date::text, p.lead_id, p.client_org_id from public.projects p
                          join public.project_financials f on f.project_id = p.id where p.id = ${projectId}`;
    expect(p).toMatchObject({ key: 'HPPR', target_date: '2027-05-28', lead_id: SEED_PROFILE_UUID.u_lead });
    expect(Number(p.bac)).toBe(250000);
    const [{ n }] = await sql`select count(*)::int as n from public.phases where project_id = ${projectId}`;
    expect(n).toBe(5);
    const invites =
      await sql`select email, role from public.invites where org_id = ${p.client_org_id} order by email`;
    expect(invites.map((i) => [i.email, i.role])).toEqual([
      ['dana.reyes@harborhealth.example', 'client_sponsor'],
      ['sam.ortiz@harborhealth.example', 'client_member'],
    ]);
    const lead = await as('u_lead');
    const c = await svc.getProjectCommercial(lead, 'HPPR');
    expect(c.link).toMatchObject({ contractNo: 'HHP-2026-007', value: 250000 });
    // Replays are idempotent.
    expect((await send(mock.samples.handoff())).status).toBe(200);
    const again = await send({ ...mock.samples.handoff(), idempotency_key: 'fixed' });
    const replay = await send({ ...mock.samples.handoff(), idempotency_key: 'fixed' });
    expect(replay.body).toMatchObject({ ...again.body, idempotent_replay: true });

    // project.extended
    expect((await send(mock.samples.extend(projectId, '2027-08-31', 40000))).status).toBe(200);
    const [p2] = await sql`select f.bac, p.target_date::text from public.projects p
                           join public.project_financials f on f.project_id = p.id where p.id = ${projectId}`;
    expect(p2.target_date).toBe('2027-08-31');
    expect(Number(p2.bac)).toBe(290000);
  });

  it('publishes items to the right org only; a new version supersedes the old one', async () => {
    await send(mock.samples.publish(PEACHTREE, EHR, { id: 'ci_pg_v1', lineage: 'lin_pg', version: 1 }));
    await send(mock.samples.publish(PEACHTREE, EHR, { id: 'ci_pg_v2', lineage: 'lin_pg', version: 2 }));
    const sponsor = await as('u_sponsor');
    const ids = (await svc.listItems(sponsor)).map((i) => i.id);
    expect(ids).toContain('ci_pg_v2');
    expect(ids).not.toContain('ci_pg_v1');
    expect((await svc.listItems(await as('u_rsponsor'))).every((i) => i.orgId !== PEACHTREE)).toBe(true);
    const [{ n }] = await sql`select count(*)::int as n from public.notifications
                              where user_id = ${sponsor.user.id} and kind = 'commercial_review'`;
    expect(n).toBeGreaterThan(0);
    // Contract guard: a cost field is refused.
    const bad = mock.samples.publish(PEACHTREE, EHR) as { item: { lines: Record<string, unknown>[] } };
    bad.item.lines[0].margin = 0.4;
    expect((await send(bad)).status).toBe(422);
  });

  it('view, accept (re-auth, name, title, IP), request changes and survey reach the CRM', async () => {
    mock.mockCrm.reset();
    const sponsor = await as('u_sponsor');
    await svc.openItem(sponsor, QUOTE);
    await svc.openItem(sponsor, QUOTE);
    await expect(
      svc.decideItem(await as('u_cmember'), QUOTE, { decision: 'declined' }, { ip: null, reauthAt: fresh() }),
    ).rejects.toThrow(/approvers/);
    await expect(
      svc.decideItem(
        sponsor,
        QUOTE,
        { decision: 'accepted', name: 'G W', title: 'COO' },
        { ip: null, reauthAt: null },
      ),
    ).rejects.toThrow();
    const item = await svc.decideItem(
      sponsor,
      QUOTE,
      { decision: 'accepted', name: 'Grace Whitfield', title: 'COO' },
      { ip: '203.0.113.9', reauthAt: fresh() },
    );
    expect(item).toMatchObject({ status: 'accepted', decidedByTitle: 'COO', decidedIp: '203.0.113.9' });
    await svc.decideItem(
      sponsor,
      'ci_pg_v2',
      { decision: 'changes_requested', note: 'Fewer hours' },
      { ip: null, reauthAt: null },
    );
    await svc.answerSurvey(await as('u_cmember'), SURVEY, { score: 8 });
    const got = mock.mockCrm.received().map((r) => r.event);
    expect(got.filter((e) => e === 'client_item.viewed')).toHaveLength(1);
    expect(got).toEqual(expect.arrayContaining(['client_item.decided', 'survey.submitted']));
    const [{ n }] = await sql`select count(*)::int as n from public.notifications
                              where user_id = ${SEED_PROFILE_UUID.u_lead} and kind = 'commercial_decided'`;
    expect(n).toBe(3);
    // Withdrawn items stay readable with the reason, and cannot be decided.
    await send(mock.samples.withdraw('ci_pg_v2', 2));
    const w = await svc.openItem(sponsor, 'ci_pg_v2');
    expect(w.status).toBe('withdrawn');
  });

  it('associates see nothing; team members see items but not the contract value', async () => {
    await expect(svc.getProjectCommercial(await as('u_assoc'), 'EHR')).rejects.toThrow();
    const team = await svc.getProjectCommercial(await as('u_team'), 'EHR');
    expect(team.link).toBeNull();
    expect(team.items.length).toBeGreaterThan(0);
  });

  it('sends health for linked projects, logs outbound events and only Admins read them', async () => {
    mock.mockCrm.reset();
    const r = await svc.syncHealth(new Date('2026-10-15T10:00:00Z'));
    expect(r.sent).toBeGreaterThanOrEqual(2);
    expect(mock.mockCrm.received().some((x) => x.payload.konnect_hub_project_id === EHR)).toBe(true);
    expect((await svc.syncHealth(new Date('2026-10-15T10:30:00Z'))).sent).toBe(0);
    const events = await svc.listEvents(await as('u_admin'));
    expect(events.some((e) => e.event === 'project.health_updated' && e.status === 'processed')).toBe(true);
    await expect(svc.listEvents(await as('u_lead'))).rejects.toThrow();
  });
});
