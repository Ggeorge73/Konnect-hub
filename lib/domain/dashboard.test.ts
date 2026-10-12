import { describe, expect, it } from 'vitest';
import {
  canSeePortfolio,
  evmAccess,
  filterPortfolio,
  keyMilestones,
  nextActions,
  projectsByGate,
  ragDistribution,
  ragOverrideError,
  suggestRag,
  topRisks,
  type RagSignals,
} from './dashboard';
import { PROFILES } from '../data/seed';
import { GATE_NAMES } from './templates';

const base: RagSignals = { spi: 1, cpi: 1, risks: [], issues: [] };
const risk = (score: number | null, status: 'open' | 'closed' = 'open') => ({
  kind: 'risk' as const,
  status,
  score,
});
const issue = (o: Partial<RagSignals['issues'][number]> = {}) => ({
  kind: 'issue' as const,
  status: 'open' as const,
  severity: 'major' as const,
  slaBreached: false,
  stale: false,
  ...o,
});
const user = (id: string) => PROFILES.find((p) => p.id === id)!;

describe('suggestRag', () => {
  it('is green when everything is on track', () => {
    expect(suggestRag(base)).toEqual({ rag: 'green', reasons: [] });
    expect(suggestRag({ ...base, spi: 0.95, cpi: 0.95, risks: [risk(14)] }).rag).toBe('green');
  });
  it('is red for SPI < 0.8 or CPI < 0.85', () => {
    expect(suggestRag({ ...base, spi: 0.79 }).rag).toBe('red');
    expect(suggestRag({ ...base, cpi: 0.849 }).rag).toBe('red');
    expect(suggestRag({ ...base, spi: 0.8, cpi: 0.85 }).rag).toBe('amber');
  });
  it('is red when an open risk scores 20 or more, ignoring closed risks', () => {
    expect(suggestRag({ ...base, risks: [risk(20)] })).toEqual({
      rag: 'red',
      reasons: ['An open risk scores 20'],
    });
    expect(suggestRag({ ...base, risks: [risk(25, 'closed')] }).rag).toBe('green');
  });
  it('is red when a Critical issue breaches its SLA, but not a Major one', () => {
    expect(suggestRag({ ...base, issues: [issue({ severity: 'critical', slaBreached: true })] }).rag).toBe(
      'red',
    );
    expect(suggestRag({ ...base, issues: [issue({ severity: 'major', slaBreached: true })] }).rag).toBe(
      'green',
    );
    expect(
      suggestRag({
        ...base,
        issues: [issue({ severity: 'critical', slaBreached: true, status: 'closed' })],
      }).rag,
    ).toBe('green');
  });
  it('is amber for SPI/CPI < 0.95, a risk of 15+, or a stale issue', () => {
    expect(suggestRag({ ...base, spi: 0.94 }).rag).toBe('amber');
    expect(suggestRag({ ...base, cpi: 0.9 }).rag).toBe('amber');
    expect(suggestRag({ ...base, risks: [risk(15)] }).rag).toBe('amber');
    expect(suggestRag({ ...base, issues: [issue({ stale: true })] })).toEqual({
      rag: 'amber',
      reasons: ['1 stale issue'],
    });
  });
  it('matches the worked example (SPI 0.857, CPI 0.900, risk 16, one stale issue) as amber', () => {
    const s = suggestRag({
      spi: 180 / 210,
      cpi: 0.9,
      risks: [risk(16), risk(12)],
      issues: [issue({ stale: true })],
    });
    expect(s.rag).toBe('amber');
    expect(s.reasons).toEqual([
      'SPI 0.857 is below 0.95',
      'CPI 0.900 is below 0.95',
      'An open risk scores 16',
      '1 stale issue',
    ]);
  });
  it('never triggers on n/a (null) ratios', () => {
    expect(suggestRag({ ...base, spi: null, cpi: null }).rag).toBe('green');
  });
  it('ignores risks without a score and non-risk entries', () => {
    expect(
      suggestRag({ ...base, risks: [risk(null), { kind: 'issue', status: 'open', score: 25 }] }).rag,
    ).toBe('green');
  });
});

describe('RAG override', () => {
  it('requires a reason', () => {
    expect(ragOverrideError('')).toMatch(/reason is required/);
    expect(ragOverrideError('   ')).toMatch(/reason is required/);
    expect(ragOverrideError(undefined)).toMatch(/reason is required/);
    expect(ragOverrideError('x'.repeat(501))).toMatch(/500/);
    expect(ragOverrideError('Client paused UAT')).toBeNull();
  });
});

describe('access', () => {
  it('limits the portfolio to internal non-associates', () => {
    expect(canSeePortfolio(user('u_admin'))).toBe(true);
    expect(canSeePortfolio(user('u_lead'))).toBe(true);
    expect(canSeePortfolio(user('u_team'))).toBe(true);
    expect(canSeePortfolio(user('u_assoc'))).toBe(false);
    expect(canSeePortfolio(user('u_sponsor'))).toBe(false);
    expect(canSeePortfolio(user('u_rsponsor'))).toBe(false);
  });
  it('shows budget/EVM to clients only when shared, and money only to financial roles', () => {
    expect(evmAccess(user('u_sponsor'), { canSeeFinancials: false, shareBudget: false })).toBe('none');
    expect(evmAccess(user('u_sponsor'), { canSeeFinancials: false, shareBudget: true })).toBe('full');
    expect(evmAccess(user('u_lead'), { canSeeFinancials: true, shareBudget: false })).toBe('full');
    expect(evmAccess(user('u_team'), { canSeeFinancials: false, shareBudget: true })).toBe('ratios');
    expect(evmAccess(user('u_assoc'), { canSeeFinancials: false, shareBudget: false })).toBe('ratios');
  });
});

describe('top risks', () => {
  it('returns the top 3 open risks by score', () => {
    const entries = [
      { kind: 'risk' as const, status: 'open' as const, score: 6, title: 'C' },
      { kind: 'risk' as const, status: 'open' as const, score: 16, title: 'A' },
      { kind: 'risk' as const, status: 'closed' as const, score: 25, title: 'Closed' },
      { kind: 'issue' as const, status: 'open' as const, score: null, title: 'Issue' },
      { kind: 'risk' as const, status: 'open' as const, score: 12, title: 'B' },
      { kind: 'risk' as const, status: 'open' as const, score: 4, title: 'D' },
    ];
    expect(topRisks(entries).map((r) => r.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('key milestones', () => {
  it('merges sprint ends, gate targets and open deliverable due dates in date order', () => {
    const m = keyMilestones(
      {
        sprints: [
          { name: 'Sprint 1', endDate: '2026-09-01' },
          { name: 'Sprint 2', endDate: '2026-10-16' },
        ],
        phases: [
          { gate: 3, name: 'Execute', endDate: '2026-12-04' },
          { gate: 4, name: 'Accept' },
        ],
        deliverables: [
          { name: 'Conversion', dueDate: '2026-10-30', status: 'submitted' },
          { name: 'Done one', dueDate: '2026-10-20', status: 'accepted' },
        ],
      },
      '2026-10-12',
    );
    expect(m.map((x) => [x.kind, x.label, x.date, x.past])).toEqual([
      ['sprint', 'Sprint 2 ends', '2026-10-16', false],
      ['deliverable', 'Conversion', '2026-10-30', false],
      ['gate', 'Gate 3 · Execute', '2026-12-04', false],
    ]);
  });
  it('keeps recent past milestones flagged as past', () => {
    const m = keyMilestones(
      { sprints: [{ name: 'S', endDate: '2026-10-02' }], phases: [], deliverables: [] },
      '2026-10-12',
    );
    expect(m).toEqual([{ kind: 'sprint', label: 'S ends', date: '2026-10-02', past: true }]);
  });
});

describe('next 30 days', () => {
  it('lists open items, deliverables and dated RAID entries due in the window', () => {
    const rows = nextActions(
      {
        items: [
          { key: 'X-1', title: 'Due soon', status: 'in_progress', dueDate: '2026-10-30' },
          { key: 'X-2', title: 'Done', status: 'done', dueDate: '2026-10-20' },
          { key: 'X-3', title: 'Later', status: 'ready', dueDate: '2026-12-01' },
          { key: 'X-4', title: 'Overdue', status: 'ready', dueDate: '2026-10-01' },
          { key: 'X-5', title: 'No date', status: 'ready', dueDate: null },
        ],
        deliverables: [
          { id: 'd1', name: 'Sign-off', status: 'submitted', dueDate: '2026-11-11' },
          { id: 'd2', name: 'Accepted', status: 'accepted', dueDate: '2026-10-20' },
        ],
        raid: [
          { id: 'r1', kind: 'dependency', title: 'Vendor endpoint', status: 'open', date: '2026-10-20' },
          { id: 'r2', kind: 'risk', title: 'Risk', status: 'open', date: '2026-10-20' },
        ],
      },
      '2026-10-12',
    );
    expect(rows.map((r) => [r.ref, r.overdue])).toEqual([
      ['X-4', true],
      ['r1', false],
      ['X-1', false],
      ['d1', false],
    ]);
  });
});

describe('portfolio helpers', () => {
  const rows = [
    { clientOrgId: 'c1', leadId: 'l1', rag: 'green' as const, gate: 3 },
    { clientOrgId: 'c1', leadId: 'l2', rag: 'amber' as const, gate: 2 },
    { clientOrgId: 'c2', leadId: 'l1', rag: 'red' as const, gate: 3 },
  ];
  it('filters by client, lead and RAG', () => {
    expect(filterPortfolio(rows, {})).toHaveLength(3);
    expect(filterPortfolio(rows, { clientId: 'c1' })).toHaveLength(2);
    expect(filterPortfolio(rows, { leadId: 'l1', rag: 'red' })).toHaveLength(1);
  });
  it('counts RAG distribution and projects by gate', () => {
    expect(ragDistribution(rows)).toEqual([
      { rag: 'green', count: 1 },
      { rag: 'amber', count: 1 },
      { rag: 'red', count: 1 },
    ]);
    expect(projectsByGate(rows, GATE_NAMES).map((g) => g.count)).toEqual([0, 1, 2, 0, 0]);
  });
});
