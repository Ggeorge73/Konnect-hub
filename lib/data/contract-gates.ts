import { describe, expect, it } from 'vitest';
import type { Session } from '../domain/types';
import { ReauthRequiredError } from './errors';
import {
  freshReauth,
  useStores,
  type DomainStores,
  type MakeStores,
  type Reset,
  type SessionFor,
} from './contract-support';

/** Gate review rules every GateStore must share (demo store and Postgres + RLS). */
export function runGateContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} gates contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    /** EHR is in gate 3 (Execute) with one open exit criterion in both seeds. */
    async function ehr({ gates }: DomainStores, s: Session) {
      const g = await gates.getGates(s, 'EHR');
      const phase = (gate: number) => g.phases.find((p) => p.gate === gate)!;
      return {
        g,
        phase,
        criteriaOf: (gate: number) => g.criteria.filter((c) => c.phaseId === phase(gate).id),
      };
    }

    async function pendingReview() {
      const lead = await as('u_lead');
      const { phase } = await ehr(st(), lead);
      return st().gates.requestReview(lead, 'EHR', {
        phaseId: phase(3).id,
        overrideNote: 'Demo moved to Friday',
      });
    }

    it('open exit criteria block a review request unless the Lead overrides them', async () => {
      const lead = await as('u_lead');
      const { gates } = st();
      const { phase, criteriaOf } = await ehr(st(), lead);
      const open = criteriaOf(3).filter((c) => !c.done);
      expect(open.length).toBeGreaterThan(0);
      await expect(gates.requestReview(lead, 'EHR', { phaseId: phase(3).id })).rejects.toThrow(
        'not complete',
      );
      await expect(
        gates.requestReview(await as('u_dev'), 'EHR', { phaseId: phase(3).id, overrideNote: 'x' }),
      ).rejects.toThrow('Lead');
      await expect(
        gates.requestReview(lead, 'EHR', { phaseId: phase(4).id, overrideNote: 'x' }),
      ).rejects.toThrow('active phase');

      const r = await gates.requestReview(lead, 'EHR', {
        phaseId: phase(3).id,
        overrideNote: 'Demo moved to Friday',
      });
      expect(r).toMatchObject({
        status: 'pending',
        overrideNote: 'Demo moved to Friday',
        gate: 3,
        requestedBy: lead.user.id,
      });
      expect(r.pack.overriddenCriteria.map((c) => c.id).sort()).toEqual(open.map((c) => c.id).sort());
      expect(r.pack.summary).toContain('Gate 3');

      const after = await ehr(st(), lead);
      expect(after.phase(3).status).toBe('ready_for_review');
      expect(after.g.reviews.some((x) => x.id === r.id && x.status === 'pending')).toBe(true);
      // Criteria lock while the review is pending, and a second request is refused.
      await expect(gates.updateCriterion(lead, 'EHR', open[0].id, { done: true })).rejects.toThrow(
        'awaiting a gate decision',
      );
      await expect(
        gates.requestReview(lead, 'EHR', { phaseId: phase(3).id, overrideNote: 'again' }),
      ).rejects.toThrow();
    });

    it('with every criterion ticked the review needs no override', async () => {
      const lead = await as('u_lead');
      const { gates } = st();
      const { phase, criteriaOf } = await ehr(st(), lead);
      const extra = await gates.addCriterion(lead, 'EHR', phase(3).id, 'Increment 2 demonstrated');
      await gates.removeCriterion(lead, 'EHR', extra.id);
      await expect(gates.addCriterion(await as('u_team'), 'EHR', phase(3).id, 'x')).rejects.toThrow('Lead');
      for (const c of criteriaOf(3)) {
        const t = await gates.updateCriterion(lead, 'EHR', c.id, { done: true });
        expect(t).toMatchObject({ done: true, doneBy: lead.user.id });
        expect(t.doneAt).toBeTruthy();
      }
      await expect(gates.updateCriterion(lead, 'EHR', criteriaOf(1)[0].id, { done: false })).rejects.toThrow(
        'already approved',
      );
      const r = await gates.requestReview(lead, 'EHR', { phaseId: phase(3).id });
      expect(r.overrideNote).toBeUndefined();
      expect(r.pack.overriddenCriteria).toEqual([]);
      expect(r.pack.completedCriteria.length).toBe(criteriaOf(3).length);
    });

    it('only the Client Sponsor of the project’s own org decides', async () => {
      const { gates } = st();
      const r = await pendingReview();
      for (const p of ['u_cmember', 'u_cviewer', 'u_lead', 'u_admin', 'u_dev'] as const)
        await expect(
          gates.decideGate(await as(p), r.id, { decision: 'approved' }, freshReauth()),
        ).rejects.toThrow('Sponsor');
      await expect(
        gates.decideGate(await as('u_rsponsor'), r.id, { decision: 'approved' }, freshReauth()),
      ).rejects.toThrow('not found');

      const sponsor = await as('u_sponsor');
      expect((await gates.listPendingReviews(sponsor)).map((x) => x.review.id)).toContain(r.id);
      const mine = (await gates.listPendingReviews(sponsor)).find((x) => x.review.id === r.id)!;
      expect(mine).toMatchObject({ projectKey: 'EHR', phaseName: 'Execute' });
      for (const p of ['u_rsponsor', 'u_cmember', 'u_lead'] as const)
        expect((await gates.listPendingReviews(await as(p))).some((x) => x.review.id === r.id)).toBe(false);
      expect((await gates.getGates(sponsor, 'EHR')).canDecide).toBe(true);
      expect((await gates.getGates(await as('u_cmember'), 'EHR')).canDecide).toBe(false);
      // Clients never see the unshared budget in the pack; the Lead does.
      expect(
        (await gates.getGates(sponsor, 'EHR')).reviews.find((x) => x.id === r.id)!.pack.budget,
      ).toBeUndefined();
      expect(
        (await gates.getGates(await as('u_lead'), 'EHR')).reviews.find((x) => x.id === r.id)!.pack.budget,
      ).toBeDefined();
    });

    it('a decision needs a fresh re-auth', async () => {
      const { gates } = st();
      const sponsor = await as('u_sponsor');
      const r = await pendingReview();
      await expect(
        gates.decideGate(sponsor, r.id, { decision: 'approved' }, { reauthAt: null }),
      ).rejects.toBeInstanceOf(ReauthRequiredError);
      const stale = new Date(Date.now() - 16 * 60_000).toISOString();
      await expect(
        gates.decideGate(sponsor, r.id, { decision: 'approved' }, { reauthAt: stale }),
      ).rejects.toThrow('reauth_required');
      expect((await gates.listPendingReviews(sponsor)).some((x) => x.review.id === r.id)).toBe(true);

      const d = await gates.decideGate(sponsor, r.id, { decision: 'approved' }, freshReauth());
      expect(d).toMatchObject({
        status: 'decided',
        decision: 'approved',
        decidedBy: sponsor.user.id,
        ip: '203.0.113.50',
      });
      expect(d.decidedAt).toBeTruthy();
      await expect(gates.decideGate(sponsor, r.id, { decision: 'approved' }, freshReauth())).rejects.toThrow(
        'already been decided',
      );
    });

    it('approval conditions become shared, tracked tasks and the next phase opens', async () => {
      const { gates, repo, acceptance } = st();
      const sponsor = await as('u_sponsor');
      const r = await pendingReview();
      await expect(
        gates.decideGate(
          sponsor,
          r.id,
          { decision: 'approved_with_conditions', conditions: [' '] },
          freshReauth(),
        ),
      ).rejects.toThrow('at least one condition');
      const d = await gates.decideGate(
        sponsor,
        r.id,
        { decision: 'approved_with_conditions', conditions: ['Fix duplicate MRNs before cutover'] },
        freshReauth(),
      );
      expect(d.conditions).toEqual(['Fix duplicate MRNs before cutover']);
      expect(d.conditionItemKeys).toHaveLength(1);
      const { item } = await repo.getItem(sponsor, d.conditionItemKeys![0]);
      expect(item).toMatchObject({
        type: 'task',
        visibility: 'shared',
        status: 'ready',
        title: 'Fix duplicate MRNs before cutover',
      });
      expect(item.labels).toContain('gate-condition');

      const { phase } = await ehr(st(), await as('u_lead'));
      expect(phase(3).status).toBe('approved_with_conditions');
      expect(phase(4).status).toBe('active');

      const record = await acceptance.buildAcceptanceRecord(sponsor, 'EHR');
      const row = record.rows.find((x) => x.kind === 'Gate decision' && x.name.startsWith('Gate 3'))!;
      expect(row).toMatchObject({ outcome: 'Approved with conditions', ip: '203.0.113.50' });
      expect(row.details).toContain('Fix duplicate MRNs');
      expect(row.by).toBe(sponsor.user.name);
      await expect(acceptance.buildAcceptanceRecord(await as('u_cmember'), 'EHR')).rejects.toThrow(
        'Only the Client Sponsor',
      );
      await expect(acceptance.buildAcceptanceRecord(await as('u_rsponsor'), 'EHR')).rejects.toThrow(
        'not found',
      );
    });

    it('a rejection needs a reason and returns the phase to active', async () => {
      const { gates } = st();
      const sponsor = await as('u_sponsor');
      const r = await pendingReview();
      await expect(gates.decideGate(sponsor, r.id, { decision: 'rejected' }, freshReauth())).rejects.toThrow(
        'reason is required',
      );
      const d = await gates.decideGate(
        sponsor,
        r.id,
        { decision: 'rejected', reason: 'Dry-run failed' },
        freshReauth(),
      );
      expect(d).toMatchObject({ decision: 'rejected', reason: 'Dry-run failed' });
      const { phase } = await ehr(st(), await as('u_lead'));
      expect(phase(3).status).toBe('active');
      expect(phase(4).status).toBe('not_started');
      // The Lead can ask again.
      expect((await pendingReview()).status).toBe('pending');
    });
  });
}
