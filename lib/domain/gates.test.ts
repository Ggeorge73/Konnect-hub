import { describe, expect, it } from 'vitest';
import { buildPhases, buildSeed } from '../data/seed';
import {
  applyDecision,
  canDecideGate,
  canEditCriteria,
  canManageGates,
  canRequestReview,
  checkExitCriteria,
  clientIp,
  conditionsToItems,
  currentPhase,
  GATE_CONDITION_LABEL,
  isReauthFresh,
  redactReview,
  validateDecision,
  type GateReview,
} from './gates';
import type { GateCriterion } from './types';

const d = buildSeed();
const user = (id: string) => d.profiles.find((p) => p.id === id)!;
const ehr = d.projects.find((p) => p.key === 'EHR')!;
const rvb = d.projects.find((p) => p.key === 'RVB')!;
const crit = (done: boolean, text = 'x'): GateCriterion => ({ id: text, phaseId: 'ph', text, done });

describe('checkExitCriteria', () => {
  it('passes when every criterion is ticked', () => {
    expect(checkExitCriteria([crit(true), crit(true)])).toEqual({ ok: true, open: [], overridden: false });
  });
  it('blocks on any unchecked criterion without an override note', () => {
    const r = checkExitCriteria([crit(true, 'a'), crit(false, 'UAT passed')]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.open.map((c) => c.text)).toEqual(['UAT passed']);
      expect(r.reason).toContain('UAT passed');
    }
    expect(checkExitCriteria([crit(false)], '   ').ok).toBe(false);
  });
  it('lets the Lead override with a note, and records that it was overridden', () => {
    const r = checkExitCriteria([crit(false, 'UAT passed')], 'Client agreed in steering to defer UAT');
    expect(r).toMatchObject({ ok: true, overridden: true });
    expect(r.open).toHaveLength(1);
  });
});

describe('who decides and manages gates', () => {
  it('only a sponsor of the project’s own client org can decide', () => {
    expect(canDecideGate(user('u_sponsor'), ehr)).toBe(true);
    expect(canDecideGate(user('u_rsponsor'), ehr)).toBe(false); // other org's sponsor
    expect(canDecideGate(user('u_rsponsor'), rvb)).toBe(true);
    for (const id of ['u_cmember', 'u_cviewer', 'u_lead', 'u_admin', 'u_team'])
      expect(canDecideGate(user(id), ehr)).toBe(false);
    expect(canDecideGate(user('u_sponsor'), { ...ehr, deletedAt: '2026-10-01' })).toBe(false);
  });
  it('only the project lead or an admin manages gates', () => {
    expect(canManageGates(user('u_lead'), ehr)).toBe(true);
    expect(canManageGates(user('u_admin'), ehr)).toBe(true);
    expect(canManageGates(user('u_team'), ehr)).toBe(false);
    expect(canManageGates(user('u_sponsor'), ehr)).toBe(false);
    expect(canManageGates(user('u_lead'), { ...ehr, leadId: 'u_admin' })).toBe(false);
  });
});

describe('phase rules', () => {
  const { phases } = buildPhases('p', 'kdf-hybrid', 3);
  it('locks criteria while under review or once approved', () => {
    expect(canEditCriteria({ ...phases[2], status: 'active' }).ok).toBe(true);
    expect(canEditCriteria({ ...phases[2], status: 'ready_for_review' }).ok).toBe(false);
    expect(canEditCriteria(phases[0]).ok).toBe(false);
    expect(canEditCriteria(phases[3]).ok).toBe(true);
  });
  it('only the active phase can be marked ready for review', () => {
    expect(canRequestReview(phases[2], phases).ok).toBe(true);
    expect(canRequestReview(phases[3], phases).ok).toBe(false);
    expect(canRequestReview({ ...phases[2], status: 'rejected' }, phases).ok).toBe(true);
    expect(currentPhase(phases)?.gate).toBe(3);
  });
  it('approval passes the phase and activates the next one', () => {
    expect(applyDecision(phases, phases[2].id, 'approved', '2026-10-12')).toEqual([
      { id: phases[2].id, status: 'approved', endDate: '2026-10-12' },
      { id: phases[3].id, status: 'active', startDate: '2026-10-12' },
    ]);
    expect(applyDecision(phases, phases[2].id, 'approved_with_conditions', 'd')[0].status).toBe(
      'approved_with_conditions',
    );
  });
  it('rejection sends the phase back to active, and the final gate has no next phase', () => {
    expect(applyDecision(phases, phases[2].id, 'rejected', 'd')).toEqual([
      { id: phases[2].id, status: 'active' },
    ]);
    expect(applyDecision(phases, phases[4].id, 'approved', 'd')).toHaveLength(1);
  });
});

describe('validateDecision and conditions', () => {
  it('requires conditions for conditional approval and a reason for rejection', () => {
    expect(validateDecision({ decision: 'approved_with_conditions', conditions: [' ', ''] }).ok).toBe(false);
    expect(validateDecision({ decision: 'rejected', reason: '  ' }).ok).toBe(false);
    expect(validateDecision({ decision: 'rejected', reason: 'UAT not run' })).toEqual({
      ok: true,
      value: { decision: 'rejected', conditions: undefined, reason: 'UAT not run' },
    });
    const v = validateDecision({ decision: 'approved_with_conditions', conditions: [' Fix EHR-16 ', ''] });
    expect(v.ok && v.value.conditions).toEqual(['Fix EHR-16']);
  });
  it('turns conditions into shared tasks labelled gate-condition', () => {
    const items = conditionsToItems(['Fix duplicate MRNs <now>', 'x'.repeat(300)], 3, 'ph4');
    expect(items).toHaveLength(2);
    for (const i of items) {
      expect(i).toMatchObject({
        type: 'task',
        visibility: 'shared',
        labels: [GATE_CONDITION_LABEL],
        phaseId: 'ph4',
      });
      expect(i.title.length).toBeLessThanOrEqual(255);
    }
    expect(items[0].description).toContain('&lt;now&gt;');
  });
});

describe('re-auth freshness', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');
  it('accepts a re-auth within 15 minutes', () => {
    expect(isReauthFresh('2026-10-12T11:45:30.000Z', now)).toBe(true);
    expect(isReauthFresh('2026-10-12T11:59:59.000Z', now)).toBe(true);
  });
  it('rejects missing, malformed or expired re-auth', () => {
    expect(isReauthFresh(null, now)).toBe(false);
    expect(isReauthFresh('not a date', now)).toBe(false);
    expect(isReauthFresh('2026-10-12T11:44:59.000Z', now)).toBe(false);
    expect(isReauthFresh('2026-10-12T13:00:00.000Z', now)).toBe(false); // far future
  });
});

describe('clientIp', () => {
  it('uses the first X-Forwarded-For address', () => {
    expect(clientIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(clientIp(null, '198.51.100.2')).toBe('198.51.100.2');
    expect(clientIp(undefined)).toBeUndefined();
  });
});

describe('redactReview', () => {
  const review: GateReview = {
    id: 'gr',
    projectId: 'p_ehr',
    phaseId: 'p_ehr_ph3',
    gate: 3,
    status: 'pending',
    requestedBy: 'u_lead',
    requestedAt: '2026-10-12T00:00:00Z',
    budgetShared: false,
    pack: {
      summary: 's',
      completedCriteria: [],
      overriddenCriteria: [],
      deliverables: [
        { id: 'a', name: 'Shared', status: 'submitted', visibility: 'shared' },
        { id: 'b', name: 'Secret', status: 'draft', visibility: 'internal' },
      ],
      openRisks: [{ id: 'r', title: 'Internal risk', visibility: 'internal' }],
      budget: { bac: 480000, contractType: 'fixed_fee', percentComplete: 40 },
    },
  };
  it('never shows budget or internal content to clients unless the lead shared the budget', () => {
    const r = redactReview(user('u_sponsor'), review);
    expect(r.pack.budget).toBeUndefined();
    expect(r.pack.deliverables.map((x) => x.name)).toEqual(['Shared']);
    expect(r.pack.openRisks).toEqual([]);
    expect(redactReview(user('u_sponsor'), { ...review, budgetShared: true }).pack.budget?.bac).toBe(480000);
  });
  it('shows budget only to finance-cleared internal roles', () => {
    expect(redactReview(user('u_lead'), review).pack.budget?.bac).toBe(480000);
    expect(redactReview(user('u_team'), review).pack.budget).toBeUndefined();
    expect(redactReview(user('u_assoc'), { ...review, budgetShared: true }).pack.budget).toBeUndefined();
    expect(redactReview(user('u_team'), review).pack.deliverables).toHaveLength(2);
  });
});
