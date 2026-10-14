import { beforeEach, describe, expect, it } from 'vitest';
import { db, memoryRepo, resetDb } from './memory';
import { sessionFor } from '../session';
import { runExport, type ExportEntity } from './exports';
import { buildProjectExport } from './project-export';
import { decideTime, logTime, submitWeek } from './ledger';
import { parseCsv, readXlsx } from '../export';

const as = (id: string) => sessionFor(id);
const csv = async (user: string, entity: ExportEntity, params: Record<string, string> = {}) => {
  const f = await runExport(as(user), entity, 'csv', new URLSearchParams(params), '203.0.113.7');
  return { file: f, rows: parseCsv(f.body.toString('utf8')) };
};
const lastAudit = () => db().audit[db().audit.length - 1];

beforeEach(() => resetDb());

describe('client exports (portal shared work list)', () => {
  it('contain only shared, non-epic items and the portal columns, never internal keys', async () => {
    const { rows } = await csv('u_sponsor', 'items', {
      project: 'EHR',
      cols: 'key,visibility,assignee,labels',
    });
    const [header, ...body] = rows;
    expect(header).toEqual(['Key']);
    const exported = new Set(body.map((r) => r[0]));
    const all = db().items.filter((i) => i.projectId === 'p_ehr' && !i.deletedAt);
    const internal = all.filter((i) => i.visibility === 'internal').map((i) => i.key);
    expect(internal.length).toBeGreaterThan(0);
    for (const k of internal) expect(exported.has(k)).toBe(false);
    const portal = all.filter((i) => i.visibility === 'shared' && i.type !== 'epic').map((i) => i.key);
    expect([...exported].sort()).toEqual([...portal].sort());

    const full = await csv('u_cviewer', 'items', { project: 'EHR' });
    expect(full.rows[0]).toEqual(['Key', 'Title', 'Type', 'Status']);
    expect(full.rows.flat().join(' ')).not.toMatch(/Internal/);
  });
  it('cannot reach other orgs, approved time, the portfolio or the audit log', async () => {
    await expect(csv('u_sponsor', 'items', { project: 'RVB' })).rejects.toThrow('not found');
    await expect(csv('u_rsponsor', 'items', { project: 'EHR' })).rejects.toThrow('not found');
    await expect(csv('u_sponsor', 'time')).rejects.toThrow('approved time');
    await expect(csv('u_sponsor', 'portfolio')).rejects.toThrow('Konnector staff');
    await expect(csv('u_sponsor', 'audit')).rejects.toThrow('Only Admins');
    await expect(csv('u_sponsor', 'timesheet', { week: '2026-10-12' })).rejects.toThrow('Konnector staff');
    const raid = await csv('u_sponsor', 'raid', { project: 'EHR' });
    expect(raid.rows.slice(1).every((r) => r[10] === 'Shared')).toBe(true);
  });
});

describe('list view exports', () => {
  it('export the List view rows: filtered, sorted and with the visible columns, as CSV or XLSX', async () => {
    const { rows } = await csv('u_lead', 'items', {
      project: 'EHR',
      q: 'appointment',
      sort: 'title',
      dir: 'desc',
      cols: 'key,title,assignee',
    });
    expect(rows[0]).toEqual(['Key', 'Title', 'Assignee']);
    const titles = rows.slice(1).map((r) => r[1]);
    expect(titles.length).toBeGreaterThan(1);
    expect(titles.every((t) => t.toLowerCase().includes('appointment'))).toBe(true);
    expect(titles).toEqual([...titles].sort((a, b) => b.toLowerCase().localeCompare(a.toLowerCase())));
    const x = await runExport(as('u_lead'), 'items', 'xlsx', new URLSearchParams({ project: 'EHR' }));
    expect(x.filename).toMatch(/^EHR-items-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const sheet = await readXlsx(x.body);
    expect(sheet.headers).toContain('Visibility');
    expect(sheet.rows.length).toBe(db().items.filter((i) => i.projectId === 'p_ehr' && !i.deletedAt).length);
  });
  it('neutralises formulas in exported text', async () => {
    db().items.find((i) => i.key === 'EHR-7')!.title = '=HYPERLINK("http://evil.example","x")';
    const { rows } = await csv('u_lead', 'items', { project: 'EHR', cols: 'key,title' });
    expect(rows.find((r) => r[0] === 'EHR-7')![1]).toBe('\'=HYPERLINK("http://evil.example","x")');
  });
  it('audits every export as export.csv / export.xlsx with the entity and row count', async () => {
    const { file } = await csv('u_lead', 'raid', { project: 'EHR', kind: 'risk' });
    expect(lastAudit()).toMatchObject({
      actorId: 'u_lead',
      action: 'export.csv',
      entity: 'raid',
      entityId: 'p_ehr',
      ip: '203.0.113.7',
      after: { entity: 'raid', rows: file.rowCount, filters: { kind: 'risk' } },
    });
    await runExport(as('u_admin'), 'portfolio', 'xlsx', new URLSearchParams({ rag: 'amber' }));
    expect(lastAudit()).toMatchObject({
      action: 'export.xlsx',
      entity: 'portfolio',
      after: { entity: 'portfolio', rows: 1, filters: { rag: 'amber' } },
    });
    await csv('u_dev', 'timesheet', { week: '2026-10-05' });
    expect(lastAudit()).toMatchObject({ action: 'export.csv', entity: 'timesheet', after: { rows: 5 } });
    await csv('u_admin', 'audit', { action: 'export.' });
    expect(lastAudit()).toMatchObject({ action: 'export.csv', entity: 'audit', after: { rows: 3 } });
  });
  it('hides money from the portfolio export without financial access', async () => {
    expect((await csv('u_admin', 'portfolio')).rows[0]).toContain('Budget variance (VAC)');
    expect((await csv('u_team', 'portfolio')).rows[0]).not.toContain('Budget variance (VAC)');
  });
});

describe('approved time export', () => {
  it('gives Leads hours without rates and Admins rate and cost columns', async () => {
    const lead = await csv('u_lead', 'time', { project: 'EHR' });
    expect(lead.rows[0]).toEqual([
      'Person',
      'Project',
      'Item',
      'Date',
      'Hours',
      'Billable',
      'Note',
      'Approved by',
      'Approved at',
    ]);
    expect(lead.rows).toHaveLength(1 + 20); // the seeded approved week on EHR
    const admin = await csv('u_admin', 'time', { project: 'EHR' });
    expect(admin.rows[0].slice(-2)).toEqual(['Cost rate', 'Cost']);
    const dev = admin.rows.find((r) => r[0] === 'Adeoba Cole' && r[3] === '2026-10-05')!;
    expect(dev).toEqual(
      expect.arrayContaining(['EHR', 'EHR-7', '6.5', 'TRUE', 'Lara Bennett', '95', '617.5']),
    );
    expect(lastAudit()).toMatchObject({ action: 'export.csv', entity: 'time', after: { rows: 20 } });
    await expect(csv('u_dev', 'time')).rejects.toThrow('approved time');
  });
  it('includes newly approved time', async () => {
    const e = await logTime(as('u_dev'), { itemId: 'EHR-7', date: '2026-10-12', hours: 2.5 });
    await submitWeek(as('u_dev'), '2026-10-12');
    await decideTime(as('u_lead'), [e.id], 'approved');
    const { rows } = await csv('u_lead', 'time', { project: 'EHR', from: '2026-10-12', to: '2026-10-18' });
    expect(rows.slice(1)).toHaveLength(1);
    expect(rows[1].slice(0, 5)).toEqual(['Adeoba Cole', 'EHR', 'EHR-7', '2026-10-12', '2.5']);
  });
});

describe('full project JSON export', () => {
  it('is Lead/Admin only, contains the whole project and is audited', async () => {
    const out = await buildProjectExport(as('u_lead'), 'ehr', '198.51.100.4');
    expect(out.project.key).toBe('EHR');
    expect(out.phases).toHaveLength(5);
    expect(out.phases[0].criteria.length).toBeGreaterThan(0);
    expect(out.items.length).toBe((await memoryRepo.listItems(as('u_lead'), { projectId: 'p_ehr' })).length);
    expect(out.comments.map((c) => c.id).sort()).toEqual(['cm_1', 'cm_2', 'cm_3']);
    expect(out.raid.length).toBeGreaterThan(0);
    expect(out.deliverables.length).toBeGreaterThan(0);
    expect(out.gateReviews.length).toBeGreaterThan(0);
    expect(lastAudit()).toMatchObject({
      action: 'export.json',
      entity: 'project',
      entityId: 'p_ehr',
      ip: '198.51.100.4',
      after: { key: 'EHR', counts: { comments: 3 } },
    });
    await expect(buildProjectExport(as('u_admin'), 'EHR')).resolves.toBeTruthy();
    for (const u of ['u_team', 'u_dev', 'u_assoc', 'u_sponsor'])
      await expect(buildProjectExport(as(u), 'EHR')).rejects.toThrow();
  });
});
