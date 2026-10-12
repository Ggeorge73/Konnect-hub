import type { EvMilestone, ProjectActual } from '../domain/evm';
import type { DashboardSettings } from '../domain/dashboard';

/** EVM baseline, actual costs and dashboard settings (KH-25, KH-26, KH-28). */
export interface InsightState {
  /** Weighted EV milestones per project (the time-phased baseline). */
  milestones: EvMilestone[];
  /**
   * Actual cost entries in integer cents. Internal only: never sent to clients unless the Lead
   * shares the budget view. TODO(Sprint 4): replaced by approved time × cost rate.
   */
  actuals: ProjectActual[];
  settings: DashboardSettings[];
}

const ms = (
  projectId: string,
  n: number,
  name: string,
  weight: number,
  startDate: string,
  dueDate: string,
  percentComplete: number,
  deliverableId?: string,
): EvMilestone => ({
  id: `ms_${projectId.slice(2)}_${n}`,
  projectId,
  name,
  weight,
  startDate,
  dueDate,
  percentComplete,
  ...(deliverableId ? { deliverableId } : {}),
});

/** Equal actual-cost entries every `everyDays` from `first` to `last` (inclusive). */
function series(
  projectId: string,
  first: string,
  last: string,
  everyDays: number,
  amountCents: number,
  note: string,
): ProjectActual[] {
  const out: ProjectActual[] = [];
  const day = 86_400_000;
  for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += everyDays * day) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ id: `act_${projectId.slice(2)}_${date}`, projectId, date, amountCents, note });
  }
  return out;
}

const monthEnds = (projectId: string, dates: string[], amountCents: number): ProjectActual[] =>
  dates.map((date) => ({
    id: `act_${projectId.slice(2)}_${date}`,
    projectId,
    date,
    amountCents,
    note: 'Monthly retainer cost',
  }));

/**
 * Demo baseline. On 2026-10-12 EHR is close to the worked example in lib/domain/evm.test.ts:
 * BAC $480,000, EV 37.5% = $180,000, PV ≈ $209,700, AC $200,000 → SPI ≈ 0.858, CPI 0.900.
 */
export function seedInsight(): { insight: InsightState } {
  const milestones: EvMilestone[] = [
    ms('p_ehr', 1, 'Mobilize complete', 5, '2026-08-03', '2026-08-21', 100),
    ms('p_ehr', 2, 'Baseline plan approved', 10, '2026-08-24', '2026-09-18', 100),
    ms('p_ehr', 3, 'Appointment conversion sign-off', 25, '2026-09-01', '2026-10-30', 64, 'dl_ehr_1'),
    ms('p_ehr', 4, 'Provider templates — wave 1', 15, '2026-09-21', '2026-11-13', 30, 'dl_ehr_2'),
    ms('p_ehr', 5, 'Lab and pharmacy integrations', 10, '2026-09-21', '2026-10-30', 20),
    ms('p_ehr', 6, 'Super-user training', 10, '2026-10-19', '2026-11-27', 0),
    ms('p_ehr', 7, 'Go-live wave 1 (Midtown, Decatur)', 13, '2026-11-30', '2026-12-18', 0),
    ms('p_ehr', 8, 'Go-live wave 2 and hypercare', 12, '2027-01-04', '2027-01-29', 0),

    ms('p_rvb', 1, 'Mobilize complete', 5, '2026-09-14', '2026-09-25', 100),
    ms('p_rvb', 2, 'Plan and backlog baseline', 10, '2026-09-28', '2026-10-23', 50),
    ms('p_rvb', 3, 'Permit application MVP', 45, '2026-10-26', '2027-01-29', 0),
    ms('p_rvb', 4, 'Inspections scheduling', 30, '2027-02-01', '2027-04-02', 0),
    ms('p_rvb', 5, 'Launch and handover', 10, '2027-04-05', '2027-04-30', 0),

    ms('p_psr', 1, 'Retainer Q1 (Jun–Aug)', 1, '2026-06-01', '2026-08-31', 100),
    ms('p_psr', 2, 'Retainer Q2 (Sep–Nov)', 1, '2026-09-01', '2026-11-30', 40),
    ms('p_psr', 3, 'Retainer Q3 (Dec–Feb)', 1, '2026-12-01', '2027-02-28', 0),
    ms('p_psr', 4, 'Retainer Q4 (Mar–May)', 1, '2027-03-01', '2027-05-31', 0),
  ];

  const actuals: ProjectActual[] = [
    // EHR: $20,000.00 every Friday from 7 Aug to 9 Oct = 10 × $20,000 = $200,000.00.
    ...series('p_ehr', '2026-08-07', '2026-10-09', 7, 2_000_000, 'Weekly delivery cost'),
    // RVB: $7,000.00 every Friday from 18 Sep to 9 Oct = $28,000.00.
    ...series('p_rvb', '2026-09-18', '2026-10-09', 7, 700_000, 'Weekly delivery cost'),
    // PSR: $8,000.00 per month end, Jun–Sep = $32,000.00.
    ...monthEnds('p_psr', ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'], 800_000),
  ];

  return {
    insight: {
      milestones,
      actuals,
      settings: [
        { projectId: 'p_ehr', shareBudget: false },
        { projectId: 'p_rvb', shareBudget: false },
        { projectId: 'p_psr', shareBudget: false },
      ],
    },
  };
}
