import type { ClientItem, CrmProjectLink, IntegrationEvent } from '../domain/crm';

/** Demo-store state for the Konnector CRM integration (lib/data/integration.ts). */
export interface CrmState {
  events: IntegrationEvent[];
  accounts: { orgId: string; crmId: string }[];
  links: CrmProjectLink[];
  items: ClientItem[];
}

const T0 = '2026-08-01T14:00:00.000Z';

/** Shared by the demo seed and supabase/seed.sql (keep the two in step). */
export const SEED_QUOTE_ID = 'ci_seed_hypercare_v1';
export const SEED_SURVEY_ID = 'ci_seed_mobilize_survey_v1';

const blankDecision = {
  firstViewedAt: null,
  firstViewedBy: null,
  decidedAt: null,
  decidedById: null,
  decidedByName: null,
  decidedByTitle: null,
  decidedByEmail: null,
  decidedIp: null,
  decisionNote: null,
  surveyScore: null,
  surveyComment: null,
  withdrawnReason: null,
  remindedAt: null,
} as const;

/**
 * The EHR and RVB demo projects as if they had been handed off from the CRM, with a quote and a
 * survey waiting in the Peachtree portal ("For your review") and a survey in Riverbend's.
 */
export function seedCrm(): { crm: CrmState } {
  return {
    crm: {
      events: [],
      accounts: [
        { orgId: 'org_peachtree', crmId: 'acc_peachtree' },
        { orgId: 'org_riverbend', crmId: 'acc_riverbend' },
      ],
      links: [
        {
          projectId: 'p_ehr',
          crmAccountId: 'acc_peachtree',
          contractNo: 'PCG-2026-014',
          value: 480000,
          currency: 'USD',
          serviceLines: ['EHR implementation', 'Go-live support'],
          scopeSummary:
            'Migrate Peachtree Clinic Group to a new EHR and support go-live across four clinics.',
          acceptanceCriteria: [
            'All four clinics live on the new EHR',
            'Patient record conversion reconciled to 99.9%',
            'Clinic staff trained and signed off',
          ],
          documents: [{ name: 'Signed SOW.pdf', url: 'https://crm.konnectortech.com/files/demo-sow.pdf' }],
          handoffKey: 'seed-handoff-ehr',
          createdAt: T0,
          lastHealth: null,
          lastHealthSentAt: null,
          changes: [],
        },
        {
          projectId: 'p_rvb',
          crmAccountId: 'acc_riverbend',
          contractNo: 'RCIT-2026-002',
          value: 310000,
          currency: 'USD',
          serviceLines: ['Digital services'],
          scopeSummary:
            'Online building-permit applications and inspections scheduling for Riverbend County.',
          acceptanceCriteria: ['Permit applications accepted online', 'Inspections bookable online'],
          documents: [],
          handoffKey: 'seed-handoff-rvb',
          createdAt: '2026-09-10T14:00:00.000Z',
          lastHealth: null,
          lastHealthSentAt: null,
          changes: [],
        },
      ],
      items: [
        {
          id: SEED_QUOTE_ID,
          lineageId: 'lin_seed_hypercare',
          version: 1,
          supersedesVersion: null,
          type: 'quote',
          orgId: 'org_peachtree',
          projectId: 'p_ehr',
          title: 'Go-live hypercare extension',
          summary: 'Four extra weeks of on-site hypercare after the last clinic goes live.',
          amount: 38400,
          currency: 'USD',
          lines: [
            {
              item: 'On-site hypercare consultant',
              description: '4 weeks × 40 h',
              qty: 160,
              unit_price: 210,
            },
            {
              item: 'Hypercare reporting',
              description: 'Weekly stabilization report',
              qty: 4,
              unit_price: 1200,
            },
          ],
          terms: 'Net 30. Valid until the respond-by date.',
          newEndDate: null,
          respondBy: '2026-11-20',
          document: {
            name: 'Quote Q-2026-031.pdf',
            url: 'https://crm.konnectortech.com/files/demo-quote.pdf',
          },
          requiresSignature: false,
          status: 'open',
          publishedAt: '2026-10-08T15:00:00.000Z',
          ...blankDecision,
        },
        {
          id: SEED_SURVEY_ID,
          lineageId: 'lin_seed_mobilize_survey',
          version: 1,
          supersedesVersion: null,
          type: 'survey',
          orgId: 'org_peachtree',
          projectId: 'p_ehr',
          title: 'How did Mobilize go?',
          summary: 'Two minutes: how likely are you to recommend Konnector to a colleague?',
          amount: null,
          currency: 'USD',
          lines: [],
          terms: null,
          newEndDate: null,
          respondBy: null,
          document: null,
          requiresSignature: false,
          status: 'open',
          publishedAt: '2026-09-02T15:00:00.000Z',
          ...blankDecision,
        },
        {
          id: 'ci_seed_rvb_survey_v1',
          lineageId: 'lin_seed_rvb_survey',
          version: 1,
          supersedesVersion: null,
          type: 'survey',
          orgId: 'org_riverbend',
          projectId: 'p_rvb',
          title: 'How is the first sprint going?',
          summary: 'How likely are you to recommend Konnector to a colleague?',
          amount: null,
          currency: 'USD',
          lines: [],
          terms: null,
          newEndDate: null,
          respondBy: null,
          document: null,
          requiresSignature: false,
          status: 'open',
          publishedAt: '2026-10-01T15:00:00.000Z',
          ...blankDecision,
        },
      ],
    },
  };
}
