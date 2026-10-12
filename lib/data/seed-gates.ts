import type { GateReview } from '../domain/gates';
import type { Deliverable } from '../domain/deliverables';

const SPONSOR_IP = '203.0.113.10';

/** Seeded gate reviews and deliverables. Mirrors supabase/seed.sql (gr_ehr_1, gr_ehr_2). */
export function seedGates(): { gateReviews: GateReview[]; deliverables: Deliverable[] } {
  const approved = (gate: 1 | 2, name: string, requestedAt: string, decidedAt: string): GateReview => ({
    id: `gr_ehr_${gate}`,
    projectId: 'p_ehr',
    phaseId: `p_ehr_ph${gate}`,
    gate,
    status: 'decided',
    requestedBy: 'u_lead',
    requestedAt,
    budgetShared: false,
    pack: {
      summary: `Gate ${gate} · ${name}: 2 of 2 exit criteria complete, 0 linked deliverables, 0 open risks.`,
      completedCriteria: [0, 1].map((i) => ({
        id: `p_ehr_ph${gate}_c${i}`,
        text:
          gate === 1
            ? ['Project charter approved', 'Acceptance criteria approved'][i]
            : ['Baseline schedule approved', 'Baseline budget approved'][i],
        doneBy: 'u_lead',
        doneAt: '2026-08-03T09:00:00.000Z',
      })),
      overriddenCriteria: [],
      deliverables: [],
      openRisks: [],
      budget: { bac: 480000, contractType: 'fixed_fee', percentComplete: 0 },
    },
    decision: 'approved',
    decidedBy: 'u_sponsor',
    decidedAt,
    ip: SPONSOR_IP,
  });

  return {
    gateReviews: [
      approved(1, 'Mobilize', '2026-08-19T14:00:00.000Z', '2026-08-21T16:00:00.000Z'),
      approved(2, 'Plan', '2026-09-16T14:00:00.000Z', '2026-09-18T16:00:00.000Z'),
    ],
    deliverables: [
      {
        id: 'dl_ehr_1',
        projectId: 'p_ehr',
        phaseId: 'p_ehr_ph3',
        name: 'Appointment conversion sign-off',
        description: 'Converted appointment data with the reconciliation report against the legacy system.',
        ownerId: 'u_lead',
        dueDate: '2026-10-30',
        visibility: 'shared',
        status: 'submitted',
        itemIds: ['wi_ehr_6', 'wi_ehr_7', 'wi_ehr_8'],
        criteria: [
          {
            id: 'dlc_ehr_1_1',
            text: 'All legacy appointment types map to a new visit type',
            status: 'pending',
          },
          {
            id: 'dlc_ehr_1_2',
            text: 'Reconciliation report shows under 0.5% variance from source',
            status: 'pending',
          },
        ],
        createdBy: 'u_lead',
        createdAt: '2026-10-05T09:00:00.000Z',
        submittedAt: '2026-10-09T09:00:00.000Z',
      },
      {
        id: 'dl_ehr_2',
        projectId: 'p_ehr',
        phaseId: 'p_ehr_ph3',
        name: 'Provider templates — wave 1',
        description: 'Family-medicine and pediatrics documentation templates.',
        ownerId: 'u_dev',
        dueDate: '2026-11-13',
        visibility: 'shared',
        status: 'draft',
        itemIds: ['wi_ehr_9', 'wi_ehr_10'],
        criteria: [
          { id: 'dlc_ehr_2_1', text: 'Templates reviewed by the clinical lead', status: 'pending' },
          { id: 'dlc_ehr_2_2', text: 'Signature block shows provider credentials', status: 'pending' },
        ],
        createdBy: 'u_lead',
        createdAt: '2026-10-07T09:00:00.000Z',
      },
    ],
  };
}
