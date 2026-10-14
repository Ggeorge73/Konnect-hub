import type { TimeEntry } from '../domain/ledger';
import { addDays } from '../domain/ledger';

/** Time tracking (KH-37 TIME-01): the demo store's time entries. Internal only. */
export interface LedgerState {
  timeEntries: TimeEntry[];
}

const WEEK = '2026-10-05'; // Monday of the week before the demo "today" (Mon 12 Oct 2026).
const SUBMITTED_AT = '2026-10-09T16:00:00.000Z';
const APPROVED_AT = '2026-10-09T17:00:00.000Z';

function entry(
  n: number,
  projectId: string,
  itemId: string,
  userId: string,
  day: number,
  hours: number,
  note: string,
  opts: Partial<TimeEntry> = {},
): TimeEntry {
  return {
    id: `te_${n}`,
    projectId,
    itemId,
    userId,
    date: addDays(WEEK, day),
    hours,
    billable: true,
    note,
    status: 'approved',
    submittedAt: SUBMITTED_AT,
    decidedBy: userId === 'u_lead' ? 'u_admin' : 'u_lead',
    decidedAt: APPROVED_AT,
    rejectReason: null,
    createdAt: `${addDays(WEEK, day)}T18:00:00.000Z`,
    updatedAt: APPROVED_AT,
    ...opts,
  };
}

/**
 * EHR has approved time for the week of 5–9 Oct 2026, the first approved week, so it is the AC
 * cutover (lib/domain/ledger.ts mergeActuals): the seeded weekly actuals up to 2 Oct ($180,000)
 * still count, the seeded $20,000 for 9 Oct is replaced by approved time × cost rate:
 *   Lara (lead)    24 h × $105 = $2,520
 *   Adeoba (dev)   32 h × $95  = $3,040
 *   Tiara (QA)     20 h × $80  = $1,600
 *   Sam (assoc)    30 h × $70  = $2,100
 *                                $9,260 → AC $189,260.00, CPI 180,000 / 189,260 ≈ 0.951.
 * Tiara also has a submitted (not yet approved) entry on PSR waiting for its Lead (the Admin).
 */
export function seedLedger(): { ledger: LedgerState } {
  const out: TimeEntry[] = [];
  let n = 1;
  const add = (
    projectId: string,
    itemId: string,
    userId: string,
    day: number,
    hours: number,
    note: string,
    opts?: Partial<TimeEntry>,
  ) => out.push(entry(n++, projectId, itemId, userId, day, hours, note, opts));
  // Lead: steering and scheduling-migration oversight, 5/5/5/5/4 h. Governance is not billable.
  [5, 5, 5, 5, 4].forEach((h, d) =>
    add('p_ehr', 'wi_ehr_1', 'u_lead', d, h, 'Steering, plan and client check-ins', { billable: false }),
  );
  // Dev: dry-run conversion Mon–Thu, provider templates Fri.
  [0, 1, 2, 3].forEach((d) => add('p_ehr', 'wi_ehr_7', 'u_dev', d, 6.5, 'Dry-run conversion'));
  add('p_ehr', 'wi_ehr_5', 'u_dev', 4, 6, 'Provider template build');
  // QA: reconciliation, 4 h a day.
  [0, 1, 2, 3, 4].forEach((d) => add('p_ehr', 'wi_ehr_8', 'u_team', d, 4, 'Reconciliation test plan'));
  // Associate: lab and pharmacy integrations, 6 h a day.
  [0, 1, 2, 3, 4].forEach((d) => add('p_ehr', 'wi_ehr_3', 'u_assoc', d, 6, 'HL7 interface specs'));
  // Pending approval: Tiara on the PSR retainer (Lead: Ada, the Admin).
  add('p_psr', 'wi_psr_1', 'u_team', 4, 3, 'Support ticket triage', {
    status: 'submitted',
    decidedBy: null,
    decidedAt: null,
    updatedAt: SUBMITTED_AT,
  });
  return { ledger: { timeEntries: out } };
}
