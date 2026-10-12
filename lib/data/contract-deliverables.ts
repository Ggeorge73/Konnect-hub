import { describe, expect, it } from 'vitest';
import type { Visibility } from '../domain/types';
import { ReauthRequiredError } from './errors';
import { freshReauth, useStores, type MakeStores, type Reset, type SessionFor } from './contract-support';

/** Deliverable acceptance rules every DeliverableStore must share (demo store and Postgres + RLS). */
export function runDeliverableContract(name: string, make: MakeStores, sessionFor: SessionFor, reset: Reset) {
  describe(`${name} deliverables contract`, () => {
    const { st, as } = useStores(make, sessionFor, reset);

    /** A deliverable linking EHR-6 (Done) and EHR-8 (Ready), with two acceptance criteria. */
    async function draft(visibility: Visibility = 'shared', name = 'Contract deliverable') {
      const lead = await as('u_lead');
      const { repo, deliverables } = st();
      const ids = [(await repo.getItem(lead, 'EHR-6')).item.id, (await repo.getItem(lead, 'EHR-8')).item.id];
      return deliverables.createDeliverable(lead, 'EHR', {
        name,
        description: 'Converted data and the reconciliation report.',
        ownerId: lead.user.id,
        dueDate: '2026-11-30',
        visibility,
        itemIds: ids,
        criteria: ['Types mapped', ' ', 'Variance under 0.5%'],
      });
    }
    async function submitted() {
      return st().deliverables.submitDeliverable(await as('u_lead'), (await draft()).id);
    }
    const status = async (key: string) => (await st().repo.getItem(await as('u_dev'), key)).item.status;

    it('clients see shared deliverables once submitted; only the Konnector team writes', async () => {
      const { deliverables } = st();
      const lead = await as('u_lead');
      const sponsor = await as('u_sponsor');
      const d = await draft();
      expect(d).toMatchObject({ status: 'draft', projectKey: 'EHR' });
      expect(d.criteria.map((c) => [c.text, c.status])).toEqual([
        ['Types mapped', 'pending'],
        ['Variance under 0.5%', 'pending'],
      ]);
      expect(d.items.map((i) => i.key).sort()).toEqual(['EHR-6', 'EHR-8']);
      const internal = await draft('internal', 'Internal estimate pack');
      await expect(
        deliverables.createDeliverable(sponsor, 'EHR', {
          name: 'x',
          ownerId: lead.user.id,
          visibility: 'shared',
          itemIds: [],
          criteria: ['x'],
        }),
      ).rejects.toThrow('Konnector team');
      await expect(
        deliverables.createDeliverable(lead, 'EHR', {
          name: 'x',
          ownerId: sponsor.user.id,
          visibility: 'shared',
          itemIds: [],
          criteria: [],
        }),
      ).rejects.toThrow('Owner');

      const seen = async () => (await deliverables.listDeliverables(sponsor, 'EHR')).map((x) => x.id);
      expect(await seen()).not.toContain(d.id);
      await expect(deliverables.submitDeliverable(lead, internal.id)).rejects.toThrow(
        'Share the deliverable',
      );
      await expect(deliverables.submitDeliverable(sponsor, d.id)).rejects.toThrow('not found');

      const s = await deliverables.submitDeliverable(lead, d.id);
      expect(s.status).toBe('submitted');
      expect(s.submittedAt).toBeTruthy();
      expect(await seen()).toContain(d.id);
      expect(await seen()).not.toContain(internal.id);
      await expect(deliverables.submitDeliverable(lead, d.id)).rejects.toThrow('Already awaiting');
      await expect(deliverables.updateDeliverable(lead, d.id, { name: 'Renamed' })).rejects.toThrow(
        'cannot be edited',
      );

      for (const p of ['u_sponsor', 'u_cmember'] as const)
        expect((await deliverables.listAwaitingAcceptance(await as(p))).map((x) => x.id)).toContain(d.id);
      for (const p of ['u_cviewer', 'u_rsponsor', 'u_lead'] as const)
        expect((await deliverables.listAwaitingAcceptance(await as(p))).map((x) => x.id)).not.toContain(d.id);
    });

    it('a criterion decision needs a client reviewer of that org and a fresh re-auth', async () => {
      const { deliverables } = st();
      const d = await submitted();
      const [c1] = d.criteria;
      for (const p of ['u_cviewer', 'u_lead', 'u_dev'] as const)
        await expect(
          deliverables.decideCriterion(await as(p), d.id, c1.id, { status: 'accepted' }, freshReauth()),
        ).rejects.toThrow('Sponsor or Members');
      await expect(
        deliverables.decideCriterion(
          await as('u_rsponsor'),
          d.id,
          c1.id,
          { status: 'accepted' },
          freshReauth(),
        ),
      ).rejects.toThrow('not found');
      await expect(
        deliverables.decideCriterion(
          await as('u_sponsor'),
          d.id,
          c1.id,
          { status: 'accepted' },
          { reauthAt: null },
        ),
      ).rejects.toBeInstanceOf(ReauthRequiredError);

      const member = await as('u_cmember');
      const r = await deliverables.decideCriterion(
        member,
        d.id,
        c1.id,
        { status: 'accepted' },
        freshReauth(),
      );
      expect(r.status).toBe('submitted');
      expect(r.criteria.find((c) => c.id === c1.id)).toMatchObject({
        status: 'accepted',
        decidedBy: member.user.id,
        ip: '203.0.113.50',
      });
    });

    it('accepting every criterion accepts the deliverable and leaves its items alone', async () => {
      const { deliverables } = st();
      const sponsor = await as('u_sponsor');
      const d = await submitted();
      for (const c of d.criteria)
        await deliverables.decideCriterion(sponsor, d.id, c.id, { status: 'accepted' }, freshReauth());
      const [after] = (await deliverables.listDeliverables(sponsor, 'EHR')).filter((x) => x.id === d.id);
      expect(after.status).toBe('accepted');
      expect(after.decidedAt).toBeTruthy();
      expect(await status('EHR-6')).toBe('done');
      expect(await status('EHR-8')).toBe('ready');
      await expect(
        deliverables.decideCriterion(sponsor, d.id, d.criteria[0].id, { status: 'rejected' }, freshReauth()),
      ).rejects.toThrow('not awaiting acceptance');
    });

    it('a rejection rejects the deliverable and reopens its linked items', async () => {
      const { deliverables, acceptance } = st();
      const sponsor = await as('u_sponsor');
      const lead = await as('u_lead');
      const d = await submitted();
      const [c1, c2] = d.criteria;
      await deliverables.decideCriterion(sponsor, d.id, c1.id, { status: 'accepted' }, freshReauth());
      expect(await status('EHR-8')).toBe('ready');
      const r = await deliverables.decideCriterion(
        sponsor,
        d.id,
        c2.id,
        { status: 'rejected', note: 'Telehealth types missing' },
        freshReauth(),
      );
      expect(r.status).toBe('rejected');
      expect(r.criteria.find((c) => c.id === c2.id)).toMatchObject({
        status: 'rejected',
        note: 'Telehealth types missing',
      });
      expect(await status('EHR-6')).toBe('in_progress');
      expect(await status('EHR-8')).toBe('in_progress');

      const record = await acceptance.buildAcceptanceRecord(sponsor, 'EHR');
      expect(
        record.rows.find(
          (x) => x.kind === 'Deliverable acceptance' && x.name.endsWith('Variance under 0.5%'),
        ),
      ).toMatchObject({ outcome: 'Rejected', details: 'Telehealth types missing' });

      // The team fixes it and resubmits: every criterion is pending again.
      expect(
        (await deliverables.updateDeliverable(lead, d.id, { name: 'Contract deliverable v2' })).name,
      ).toBe('Contract deliverable v2');
      const again = await deliverables.submitDeliverable(lead, d.id);
      expect(again.status).toBe('submitted');
      expect(again.criteria.every((c) => c.status === 'pending')).toBe(true);
    });
  });
}
