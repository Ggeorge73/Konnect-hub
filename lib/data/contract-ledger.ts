import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from './repo';
import type { LedgerStore } from './ledger';
import type { AuditStore } from './audit';
import type { SessionFor, Reset } from './contract-support';
import { approvedTimeColumns } from './exports';

export interface LedgerStores {
  repo: Repo;
  ledger: LedgerStore;
  audit: AuditStore;
}

/** A week with no seeded time in either backend (Mon 11 – Sun 17 Jan 2027). */
const WEEK = '2027-01-11';
const WED = '2027-01-13';

/**
 * Time tracking (KH-37) and audit log (KH-38) rules every LedgerStore / AuditStore must share:
 * the demo store (memory.test.ts) and Postgres + RLS (postgres.test.ts). Seed-agnostic: only
 * project / item keys and personas from the shared seed, and deltas instead of absolute totals.
 */
export function runLedgerContract(
  name: string,
  make: () => LedgerStores,
  sessionFor: SessionFor,
  reset: Reset,
) {
  describe(`${name} ledger contract`, () => {
    let st: LedgerStores;
    const as = (p: Parameters<SessionFor>[0]) => Promise.resolve(sessionFor(p));
    beforeEach(async () => {
      await reset();
      st = make();
    });

    it('internal users log quarter hours on items; clients and unassigned associates cannot', async () => {
      const { ledger } = st;
      const dev = await as('u_dev');
      const e = await ledger.logTime(dev, { itemId: 'EHR-7', date: WED, hours: 2.5, note: ' Dry-run ' });
      expect(e).toMatchObject({
        hours: 2.5,
        billable: true,
        note: 'Dry-run',
        status: 'draft',
        itemKey: 'EHR-7',
        projectKey: 'EHR',
        userName: 'Adeoba Cole',
      });
      expect(e.costRate).toBeUndefined();
      for (const hours of [0, -1, 0.3, 24.25])
        await expect(ledger.logTime(dev, { itemId: 'EHR-7', date: WED, hours })).rejects.toThrow();
      await expect(ledger.logTime(dev, { itemId: 'EHR-7', date: '2027-02-30', hours: 1 })).rejects.toThrow(
        'valid date',
      );
      await expect(
        ledger.logTime(await as('u_sponsor'), { itemId: 'EHR-7', date: WED, hours: 1 }),
      ).rejects.toThrow('Konnector staff');
      const assoc = await as('u_assoc');
      await expect(ledger.logTime(assoc, { itemId: 'RVB-2', date: WED, hours: 1 })).rejects.toThrow(
        'not found',
      );
      expect((await ledger.logTime(assoc, { itemId: 'EHR-12', date: WED, hours: 0.25 })).hours).toBe(0.25);
    });

    it('clients never see time entries or logged hours', async () => {
      const { ledger } = st;
      await ledger.logTime(await as('u_dev'), { itemId: 'EHR-7', date: WED, hours: 1 });
      for (const p of ['u_sponsor', 'u_cmember', 'u_cviewer'] as const) {
        const c = await as(p);
        await expect(ledger.listWeek(c, WEEK)).rejects.toThrow('Konnector staff');
        await expect(ledger.itemTime(c, 'EHR-7')).rejects.toThrow('Konnector staff');
        await expect(ledger.listApprovals(c)).rejects.toThrow();
        await expect(ledger.listApproved(c, {})).rejects.toThrow();
        await expect(ledger.approvedCost(c, 'EHR', WED)).rejects.toThrow();
      }
    });

    it('people see their own week; item totals count everyone', async () => {
      const { ledger } = st;
      const dev = await as('u_dev');
      const team = await as('u_team');
      const before = await ledger.itemTime(dev, 'EHR-7');
      await ledger.logTime(dev, { itemId: 'EHR-7', date: WED, hours: 2 });
      await ledger.logTime(dev, { itemId: 'EHR-7', date: '2027-01-17', hours: 1.5, billable: false });
      await ledger.logTime(dev, { itemId: 'EHR-7', date: '2027-01-18', hours: 8 }); // next week
      await ledger.logTime(team, { itemId: 'EHR-7', date: WED, hours: 3 });
      const week = await ledger.listWeek(dev, WEEK);
      expect(week.map((e) => [e.date, e.hours, e.billable])).toEqual([
        [WED, 2, true],
        ['2027-01-17', 1.5, false],
      ]);
      expect((await ledger.listWeek(team, WEEK)).map((e) => e.userName)).toEqual(['Tiara Mensah']);
      await expect(ledger.listWeek(dev, WED)).rejects.toThrow('Monday');
      const after = await ledger.itemTime(dev, 'EHR-7');
      expect(after.totalHours - before.totalHours).toBeCloseTo(14.5, 10);
      expect(after.myHours - before.myHours).toBeCloseTo(11.5, 10);
      expect(after.mine.every((e) => e.userName === 'Adeoba Cole')).toBe(true);
      expect((await ledger.itemTime(team, 'EHR-7')).totalHours).toBe(after.totalHours);
    });

    it('submit → reject with reason → edit → resubmit → approve; approved time is locked', async () => {
      const { ledger } = st;
      const dev = await as('u_dev');
      const lead = await as('u_lead');
      const e = await ledger.logTime(dev, { itemId: 'EHR-7', date: WED, hours: 2.5 });
      const edited = await ledger.updateTime(dev, e.id, { hours: 3, note: 'More dry-run' });
      expect(edited).toMatchObject({ hours: 3, note: 'More dry-run', status: 'draft' });

      // Only Leads / Admins see the approval queue; nothing is there until the week is submitted.
      await expect(ledger.listApprovals(dev)).rejects.toThrow('approve time');
      expect((await ledger.listApprovals(lead)).some((x) => x.id === e.id)).toBe(false);
      const submitted = await ledger.submitWeek(dev, WEEK);
      expect(submitted.map((x) => [x.id, x.status])).toEqual([[e.id, 'submitted']]);
      expect(submitted[0].submittedAt).toBeTruthy();
      await expect(ledger.submitWeek(dev, WEEK)).rejects.toThrow('no draft time');
      await expect(ledger.updateTime(dev, e.id, { hours: 4 })).rejects.toThrow('read-only');
      await expect(ledger.deleteTime(dev, e.id)).rejects.toThrow('read-only');

      const queue = await ledger.listApprovals(lead);
      expect(queue.find((x) => x.id === e.id)).toMatchObject({ userName: 'Adeoba Cole', hours: 3 });
      expect(queue.every((x) => x.status === 'submitted')).toBe(true);
      // A Team Member cannot decide, and a rejection needs a reason.
      await expect(ledger.decideTime(dev, [e.id], 'approved')).rejects.toThrow();
      await expect(ledger.decideTime(lead, [e.id], 'rejected', '  ')).rejects.toThrow('reason');

      const [rej] = await ledger.decideTime(lead, [e.id], 'rejected', 'Split by ticket, please');
      expect(rej).toMatchObject({ status: 'rejected', rejectReason: 'Split by ticket, please' });
      expect(rej.decidedByName).toBe('Lara Bennett');
      await expect(ledger.decideTime(lead, [e.id], 'approved')).rejects.toThrow('Only submitted');

      const fixed = await ledger.updateTime(dev, e.id, { hours: 2.5 });
      expect(fixed.status).toBe('draft');
      await ledger.submitWeek(dev, WEEK);
      const [ok] = await ledger.decideTime(lead, [e.id], 'approved');
      expect(ok).toMatchObject({ status: 'approved', rejectReason: null, decidedByName: 'Lara Bennett' });
      expect(ok.decidedAt).toBeTruthy();

      await expect(ledger.updateTime(dev, e.id, { hours: 1 })).rejects.toThrow('locked');
      await expect(ledger.deleteTime(dev, e.id)).rejects.toThrow('locked');
      await expect(ledger.decideTime(lead, [e.id], 'rejected', 'late')).rejects.toThrow('Only submitted');
      expect((await ledger.listApprovals(lead)).some((x) => x.id === e.id)).toBe(false);
      // Nobody else can touch another person's entry.
      await expect(ledger.updateTime(await as('u_team'), e.id, { hours: 1 })).rejects.toThrow('not found');
    });

    it('only the project Lead or an Admin approves; the Admin sees everything', async () => {
      const { ledger } = st;
      const team = await as('u_team');
      const e = await ledger.logTime(team, { itemId: 'PSR-1', date: WED, hours: 1 });
      await ledger.submitWeek(team, WEEK);
      const lead = await as('u_lead');
      expect((await ledger.listApprovals(lead)).some((x) => x.id === e.id)).toBe(false);
      await expect(ledger.decideTime(lead, [e.id], 'approved')).rejects.toThrow();
      const admin = await as('u_admin');
      expect((await ledger.listApprovals(admin)).some((x) => x.id === e.id)).toBe(true);
      expect((await ledger.decideTime(admin, [e.id], 'approved'))[0].status).toBe('approved');
    });

    it('approved time adds hours × cost rate to actual cost; rates are Admin only', async () => {
      const { ledger } = st;
      const dev = await as('u_dev');
      const lead = await as('u_lead');
      const admin = await as('u_admin');
      const ac0 = await ledger.approvedCost(lead, 'EHR', WED);
      const e = await ledger.logTime(dev, { itemId: 'EHR-7', date: WED, hours: 2.5, note: '=SUM(A1)' });
      await ledger.submitWeek(dev, WEEK);
      expect(await ledger.approvedCost(lead, 'EHR', WED)).toBe(ac0);
      await ledger.decideTime(lead, [e.id], 'approved');
      // $95/h × 2.5 h = $237.50, counted from the entry date on.
      expect((await ledger.approvedCost(lead, 'EHR', WED)) - ac0).toBe(23_750);
      expect(await ledger.approvedCost(admin, 'EHR', '2027-01-12')).toBe(ac0);
      await expect(ledger.approvedCost(dev, 'EHR', WED)).rejects.toThrow('Admins and Delivery Leads');

      const leadRows = await ledger.listApproved(lead, { projectKey: 'EHR', from: WEEK, to: '2027-01-17' });
      expect(leadRows.map((r) => r.id)).toEqual([e.id]);
      expect(leadRows[0]).toMatchObject({ userName: 'Adeoba Cole', decidedByName: 'Lara Bennett' });
      expect(leadRows[0].costRate).toBeUndefined();
      expect(leadRows[0].costCents).toBeUndefined();
      const adminRows = await ledger.listApproved(admin, { projectKey: 'EHR', from: WEEK, to: '2027-01-17' });
      expect(adminRows[0]).toMatchObject({ costRate: 95, costCents: 23_750 });
      expect(approvedTimeColumns(lead.user).map((c) => c.label)).not.toContain('Cost rate');
      expect(approvedTimeColumns(admin.user).map((c) => c.label)).toEqual([
        'Person',
        'Project',
        'Item',
        'Date',
        'Hours',
        'Billable',
        'Note',
        'Approved by',
        'Approved at',
        'Cost rate',
        'Cost',
      ]);
      await expect(ledger.listApproved(dev, {})).rejects.toThrow('approve time');
    });

    it('the audit log is Admin only, newest first, filterable and paginated', async () => {
      const { audit } = st;
      const lead = await as('u_lead');
      const admin = await as('u_admin');
      await expect(audit.listAudit(lead, {})).rejects.toThrow('Only Admins');
      await audit.record(
        lead,
        { action: 'export.csv', entity: 'items', entityId: 'items', after: { entity: 'items', rows: 3 } },
        '203.0.113.9',
      );
      await audit.record(admin, { action: 'export.xlsx', entity: 'portfolio', entityId: 'portfolio' });
      await audit.recordLogin(lead.user.id, 'demo_persona', '198.51.100.1');

      const exportsOnly = await audit.listAudit(admin, { actionPrefix: 'EXPORT.' });
      expect(exportsOnly.rows.slice(0, 2).map((r) => r.action)).toEqual(['export.xlsx', 'export.csv']);
      const csv = exportsOnly.rows[1];
      expect(csv).toMatchObject({
        actorId: lead.user.id,
        actorName: 'Lara Bennett',
        entity: 'items',
        after: { entity: 'items', rows: 3 },
        ip: '203.0.113.9',
      });
      const mine = await audit.listAudit(admin, { actorId: lead.user.id, actionPrefix: 'auth.' });
      expect(mine.rows[0]).toMatchObject({ action: 'auth.login', entity: 'session', ip: '198.51.100.1' });
      expect(mine.actors.some((a) => a.name === 'Lara Bennett')).toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      expect((await audit.listAudit(admin, { from: today, to: today })).total).toBeGreaterThanOrEqual(3);
      expect((await audit.listAudit(admin, { to: '2000-01-01' })).total).toBe(0);
      await expect(audit.listAudit(admin, { from: '2026-10-12', to: '2026-10-01' })).rejects.toThrow();
      const p1 = await audit.listAudit(admin, { pageSize: 2 });
      const p2 = await audit.listAudit(admin, { pageSize: 2, page: 2 });
      expect(p1.rows).toHaveLength(2);
      expect(p1.total).toBe(p2.total);
      expect(p2.rows.map((r) => r.id)).not.toContain(p1.rows[0].id);
    });
  });
}
