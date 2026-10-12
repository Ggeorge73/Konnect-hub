import type { ItemLink, Phase } from '../domain/types';
import type { PlanningState } from '../domain/sprints';

/** Demo planning state: hours-per-point per project and no epic overrides yet. */
export function seedPlanning(): PlanningState {
  return {
    settings: [
      { projectId: 'p_ehr', hoursPerPoint: 6 },
      { projectId: 'p_rvb', hoursPerPoint: 6 },
    ],
    schedules: [],
  };
}

const EHR_PHASE_DATES: Record<number, [string, string]> = {
  1: ['2026-08-03', '2026-08-21'],
  2: ['2026-08-24', '2026-09-18'],
  3: ['2026-09-21', '2026-12-04'],
  4: ['2026-12-07', '2027-01-08'],
  5: ['2027-01-11', '2027-01-29'],
};

/** Real-looking phase dates for the demo EHR project (the timeline falls back to an even split). */
export const datedEhrPhases = (phases: Phase[]): Phase[] =>
  phases.map((p) => ({ ...p, startDate: EHR_PHASE_DATES[p.gate][0], endDate: EHR_PHASE_DATES[p.gate][1] }));

/** Epic-level dependencies so the demo timeline shows arrows. */
export const SEED_TIMELINE_LINKS: ItemLink[] = [
  { id: 'ln_tl_1', fromId: 'wi_ehr_1', toId: 'wi_ehr_2', type: 'blocks' },
  { id: 'ln_tl_2', fromId: 'wi_ehr_3', toId: 'wi_ehr_2', type: 'blocks' },
];
