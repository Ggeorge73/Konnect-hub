import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb } from './memory';
import { sessionFor } from '../session';
import {
  actualCostFor,
  getDashboard,
  getPortfolio,
  listDashboardAudit,
  overrideRag,
  projectEvm,
  setShareBudget,
} from './insight';
import { formatMoney, formatRatio, roundHalfEven } from '../domain/evm';

const as = (id: string) => sessionFor(id);
const NOW = new Date('2026-10-12T12:00:00Z');
const ehr = () => db().projects.find((p) => p.key === 'EHR')!;

beforeEach(() => resetDb());

describe('EVM from the seeded baseline', () => {
  it('reads AC from seeded actuals through the actualCostFor hook', () => {
    expect(actualCostFor('p_ehr', '2026-10-12')).toBe(20_000_000);
    expect(actualCostFor('p_ehr', '2026-08-06')).toBe(0);
    expect(actualCostFor('p_rvb', '2026-10-12')).toBe(2_800_000);
    expect(actualCostFor('p_new', '2026-10-12')).toBe(0);
  });
  it('gives EHR EV 37.5% of BAC and CPI 0.900 on 12 Oct 2026', () => {
    const e = projectEvm(ehr(), '2026-10-12');
    expect(e.percentComplete).toBeCloseTo(37.5, 10);
    expect(formatMoney(e.ev)).toBe('$180,000.00');
    expect(formatMoney(e.ac)).toBe('$200,000.00');
    expect(formatRatio(e.cpi)).toBe('0.900');
    expect(e.spi!).toBeGreaterThan(0.85);
    expect(e.spi!).toBeLessThan(0.87);
  });
  it('counts a deliverable-linked milestone as complete once the deliverable is accepted', () => {
    db().deliverables.find((x) => x.id === 'dl_ehr_1')!.status = 'accepted';
    // 37.5% + 25 × (100 − 64)% = 46.5%
    expect(projectEvm(ehr(), '2026-10-12').percentComplete).toBeCloseTo(46.5, 10);
  });
  it('falls back to a linear phase baseline with n/a ratios for a project with no milestones or actuals', () => {
    const p = { ...ehr(), id: 'p_new', key: 'NEW' };
    const e = projectEvm(p, '2026-08-01');
    expect(e.pv).toBe(0);
    expect(e.spi).toBeNull();
    expect(e.cpi).toBeNull();
    expect(e.eac).toBeNull();
  });
});

describe('project dashboard', () => {
  it('gives the Lead full EVM, a burn series, the suggestion and the top 3 risks', async () => {
    const v = await getDashboard(as('u_lead'), 'EHR', NOW);
    expect(v.evmAccess).toBe('full');
    expect(v.evm?.bac).toBe(48_000_000);
    expect(v.burn?.length).toBeGreaterThan(10);
    expect(v.burn?.find((b) => b.date === '2026-10-12')?.actual).toBe(20_000_000);
    expect(v.suggested?.rag).toBe('amber');
    expect(v.canOverride).toBe(true);
    expect(v.topRisks.map((r) => r.score)).toEqual([16, 12, 6]);
    expect(v.milestones.some((m) => m.kind === 'sprint')).toBe(true);
    expect(v.milestones.some((m) => m.kind === 'deliverable')).toBe(true);
    expect(v.actions.length).toBeGreaterThan(0);
  });
  it('gives other internal roles ratios only, no money', async () => {
    for (const id of ['u_team', 'u_assoc']) {
      const v = await getDashboard(as(id), 'EHR', NOW);
      expect(v.evmAccess).toBe('ratios');
      expect(v.evm?.bac).toBeNull();
      expect(v.evm?.vac).toBeNull();
      expect(v.evm?.cpi).not.toBeNull();
      expect(v.burn).toBeNull();
      expect(v.canOverride).toBe(false);
    }
  });
  it('gives clients a client-safe view: no budget/EVM, no suggestion, shared risks only', async () => {
    const v = await getDashboard(as('u_sponsor'), 'EHR', NOW);
    expect(v.evmAccess).toBe('none');
    expect(v.evm).toBeNull();
    expect(v.burn).toBeNull();
    expect(v.suggested).toBeNull();
    expect(v.topRisks.map((r) => r.id)).toEqual(['rd_ehr_1']);
    expect(JSON.stringify(v)).not.toContain('48000000');
    expect(v.actions.every((a) => a.href.startsWith('/portal/EHR'))).toBe(true);
  });
  it('shows clients budget/EVM only after the Lead shares it', async () => {
    await setShareBudget(as('u_lead'), 'EHR', true);
    const v = await getDashboard(as('u_cviewer'), 'EHR', NOW);
    expect(v.evmAccess).toBe('full');
    expect(roundHalfEven(v.evm!.ac!)).toBe(20_000_000);
    expect(v.burn).not.toBeNull();
  });
  it('hides other clients projects', async () => {
    await expect(getDashboard(as('u_rsponsor'), 'EHR', NOW)).rejects.toThrow('Project not found');
  });
});

describe('RAG override', () => {
  it('requires a reason and is audited with before/after', async () => {
    await expect(overrideRag(as('u_lead'), 'EHR', { rag: 'red', reason: ' ' })).rejects.toThrow(
      'reason is required',
    );
    const out = await overrideRag(
      as('u_lead'),
      'EHR',
      { rag: 'red', reason: 'UAT slipped a week' },
      '10.0.0.1',
    );
    expect(out).toEqual({ rag: 'red', ragReason: 'UAT slipped a week' });
    expect(ehr().rag).toBe('red');
    const audit = await listDashboardAudit(as('u_lead'), 'EHR');
    expect(audit[0]).toMatchObject({
      action: 'project.rag_override',
      actorId: 'u_lead',
      before: { rag: 'amber' },
      after: { rag: 'red', ragReason: 'UAT slipped a week' },
      ip: '10.0.0.1',
    });
    const v = await getDashboard(as('u_lead'), 'EHR', NOW);
    expect(v.rag).toBe('red');
    expect(v.suggested?.rag).toBe('amber');
  });
  it('is Lead/Admin only', async () => {
    for (const id of ['u_team', 'u_dev', 'u_assoc', 'u_sponsor'])
      await expect(overrideRag(as(id), 'EHR', { rag: 'green', reason: 'x' })).rejects.toThrow();
    await expect(
      overrideRag(as('u_admin'), 'EHR', { rag: 'green', reason: 'Recovered' }),
    ).resolves.toBeTruthy();
    await expect(listDashboardAudit(as('u_team'), 'EHR')).rejects.toThrow('Only the project Lead');
  });
  it('audits budget sharing only when it changes', async () => {
    await setShareBudget(as('u_lead'), 'EHR', false);
    await setShareBudget(as('u_lead'), 'EHR', true);
    const audit = await listDashboardAudit(as('u_lead'), 'EHR');
    expect(audit.filter((a) => a.action === 'dashboard.share_budget')).toHaveLength(1);
    await expect(setShareBudget(as('u_sponsor'), 'EHR', true)).rejects.toThrow();
  });
});

describe('portfolio', () => {
  it('blocks associates and clients', async () => {
    await expect(getPortfolio(as('u_assoc'), NOW)).rejects.toThrow('Konnector staff');
    await expect(getPortfolio(as('u_sponsor'), NOW)).rejects.toThrow('Konnector staff');
  });
  it('shows the admin every project with money', async () => {
    const v = await getPortfolio(as('u_admin'), NOW);
    expect(v.rows.map((r) => r.key)).toEqual(['EHR', 'PSR', 'RVB']);
    expect(v.money).toBe(true);
    const e = v.rows.find((r) => r.key === 'EHR')!;
    expect(e).toMatchObject({
      rag: 'amber',
      suggestedRag: 'amber',
      gate: 3,
      gateName: 'Execute',
      criticalRisks: 1,
    });
    expect(e.vac).not.toBeNull();
    expect(v.clients.map((c) => c.name)).toEqual(['Peachtree Clinic Group', 'Riverbend County IT']);
  });
  it('shows team members only their projects and no money', async () => {
    const v = await getPortfolio(as('u_team'), NOW);
    expect(v.rows.map((r) => r.key)).toEqual(['EHR', 'PSR']);
    expect(v.money).toBe(false);
    expect(v.rows.every((r) => r.vac === null)).toBe(true);
  });
  it('shows the lead the projects they lead', async () => {
    const v = await getPortfolio(as('u_lead'), NOW);
    expect(v.rows.map((r) => r.key)).toEqual(['EHR', 'RVB']);
  });
});
