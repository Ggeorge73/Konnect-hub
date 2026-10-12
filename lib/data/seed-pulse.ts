import type { ItemStatus, ItemType, Sprint, WorkItem } from '../domain/types';
import type { SprintCommitment, StatusChange } from '../domain/metrics';
import type { ReportSections, StatusReport } from '../domain/reports';

/** Team Pulse arrays on the demo store (wired into `Db` and `buildSeed()` in lib/data/seed.ts). */
export interface PulseDb {
  /** Every status change of a work item (AGL-01). Appended by `memoryRepo.updateItem`. */
  statusHistory: StatusChange[];
  /** Start-of-sprint commitment snapshots for velocity. */
  sprintCommitments: SprintCommitment[];
  /**
   * Closed sprints and their finished items from before the project moved into Konnect Hub
   * (discovery and design were tracked elsewhere and imported for metrics history). They feed the
   * agile metrics only; they are not on boards, backlogs or the timeline.
   */
  metricsArchive: { sprints: Sprint[]; items: WorkItem[] };
  /** Weekly status reports (RPT-01). */
  statusReports: StatusReport[];
}

/** Four completed EHR sprints before "EHR Sprint 1", so velocity has six sprints of history. */
const ARCHIVED_SPRINTS: Sprint[] = [
  [
    's_ehr_d1',
    'EHR Discovery 1',
    '2026-08-03',
    '2026-08-14',
    'p_ehr_ph1',
    'Mobilize the team and confirm scope',
  ],
  [
    's_ehr_d2',
    'EHR Discovery 2',
    '2026-08-17',
    '2026-08-28',
    'p_ehr_ph2',
    'Current state and conversion strategy',
  ],
  [
    's_ehr_d3',
    'EHR Design 1',
    '2026-08-31',
    '2026-09-11',
    'p_ehr_ph2',
    'Standards, security and test approach',
  ],
  ['s_ehr_d4', 'EHR Design 2', '2026-09-14', '2026-09-18', 'p_ehr_ph2', 'Plan gate pack'],
].map(([id, name, startDate, endDate, phaseId, goal]) => ({
  id,
  projectId: 'p_ehr',
  phaseId,
  name,
  startDate,
  endDate,
  goal,
  status: 'completed' as const,
  capacityHours: 200,
}));

/**
 * Timeline codes: r ready, p in progress, v in review, c client review, d done, a accepted.
 * "p:09-22" = moved to In Progress on 2026-09-22 (15:00 UTC). Items start in Backlog.
 */
const CODE: Record<string, ItemStatus> = {
  r: 'ready',
  p: 'in_progress',
  v: 'in_review',
  c: 'client_review',
  d: 'done',
  a: 'accepted',
};

/** [n, sprint finished in, type, title, points, assignee, created (MM-DD), timeline]. */
type ArchiveSeed = [number, string, ItemType, string, number, string, string, string];

const ARCHIVED_ITEMS: ArchiveSeed[] = [
  [
    1,
    's_ehr_d1',
    'task',
    'Kick-off workshop with clinic managers',
    2,
    'u_lead',
    '08-03',
    'r:08-03 p:08-04 d:08-05',
  ],
  [2, 's_ehr_d1', 'task', 'Confirm clinic list and go-live order', 3, 'u_lead', '08-03', 'p:08-05 d:08-10'],
  [
    3,
    's_ehr_d1',
    'task',
    'Collect legacy system access for four clinics',
    3,
    'u_assoc',
    '08-03',
    'p:08-04 v:08-11 d:08-13',
  ],
  [4, 's_ehr_d1', 'task', 'Draft stakeholder communication plan', 2, 'u_lead', '08-03', 'p:08-10 d:08-12'],
  [
    5,
    's_ehr_d2',
    'story',
    'Current-state scheduling workflow interviews',
    5,
    'u_team',
    '08-03',
    'r:08-03 p:08-11 d:08-20',
  ],
  [
    6,
    's_ehr_d2',
    'story',
    'Inventory legacy appointment types',
    5,
    'u_dev',
    '08-17',
    'p:08-18 v:08-24 d:08-26',
  ],
  [7, 's_ehr_d2', 'task', 'Document integration landscape', 3, 'u_assoc', '08-17', 'p:08-19 d:08-25'],
  [8, 's_ehr_d2', 'story', 'Draft data conversion strategy', 5, 'u_dev', '08-17', 'p:08-20 v:08-27 d:08-28'],
  [9, 's_ehr_d3', 'task', 'Baseline schedule draft', 3, 'u_lead', '08-17', 'p:08-26 d:09-02'],
  [10, 's_ehr_d3', 'story', 'Template build standards', 3, 'u_dev', '08-31', 'p:09-01 d:09-04'],
  [
    11,
    's_ehr_d3',
    'task',
    'Security and access role matrix',
    5,
    'u_assoc',
    '08-31',
    'p:09-01 v:09-08 d:09-09',
  ],
  [
    12,
    's_ehr_d3',
    'story',
    'Test strategy and UAT approach',
    5,
    'u_team',
    '08-31',
    'p:09-03 v:09-09 d:09-11',
  ],
  [
    13,
    's_ehr_d3',
    'task',
    'Interface specification for lab results feed',
    3,
    'u_assoc',
    '08-31',
    'p:09-07 d:09-10',
  ],
  [14, 's_ehr_d4', 'task', 'Training needs analysis', 2, 'u_team', '08-31', 'r:09-01 p:09-10 d:09-15'],
  [15, 's_ehr_d4', 'task', 'Assemble Plan gate pack', 3, 'u_lead', '09-14', 'p:09-14 d:09-16'],
  [16, 's_ehr_d4', 'task', 'Cutover approach outline', 3, 'u_lead', '09-14', 'p:09-15 d:09-17'],
];

/** History for the seeded EHR-1..24 items, so cumulative flow and cycle time read true. */
const LIVE_HISTORY: [number, string][] = [
  [6, 'r:09-18 p:09-22 v:09-29 d:10-01'],
  [14, 'p:09-22 d:09-25'],
  [23, 'p:09-28 d:09-29'],
  [24, 'r:09-18 p:09-22 v:09-28 c:09-30 a:10-02'],
  [7, 'r:09-18 p:09-24'],
  [9, 'r:10-02 p:10-05 v:10-08 c:10-09'],
  [10, 'r:10-02 p:10-06 v:10-09'],
  [12, 'r:10-02 p:10-07'],
  [16, 'p:10-08'],
  [8, 'r:10-02'],
  [13, 'r:10-02'],
  [17, 'r:10-02'],
  [21, 'r:10-02'],
];

const archivedId = (n: number) => `wi_ehr_h${n}`;
const liveId = (n: number) => `wi_ehr_${n}`;

/** Items committed at each sprint's start. EHR-6 was planned for Design 2 and slipped to Sprint 1. */
const COMMITMENTS: [string, string, string[]][] = [
  ['s_ehr_d1', '2026-08-03', [1, 2, 3, 4, 5].map(archivedId)],
  ['s_ehr_d2', '2026-08-17', [5, 6, 7, 8, 9].map(archivedId)],
  ['s_ehr_d3', '2026-08-31', [9, 10, 11, 12, 13, 14].map(archivedId)],
  ['s_ehr_d4', '2026-09-14', [...[14, 15, 16].map(archivedId), liveId(6)]],
  ['s_ehr1', '2026-09-21', [6, 7, 14, 23, 24].map(liveId)],
  ['s_ehr2', '2026-10-05', [7, 9, 10, 12].map(liveId)],
];

const at = (mmdd: string, hh = '15') => `2026-${mmdd}T${hh}:00:00.000Z`;

function timeline(itemId: string, actorId: string, codes: string): StatusChange[] {
  let from: ItemStatus = 'backlog';
  return codes.split(' ').map((c, k) => {
    const [code, mmdd] = c.split(':');
    const to = CODE[code];
    const change: StatusChange = {
      id: `sh_${itemId}_${k}`,
      projectId: 'p_ehr',
      itemId,
      from,
      to,
      at: at(mmdd),
      actorId: to === 'accepted' ? 'u_sponsor' : actorId,
    };
    from = to;
    return change;
  });
}

/** Internal working copy of the published report for the week of Oct 5 (as the Lead edited it). */
const REPORT_1005: ReportSections = {
  scope:
    '<p><strong>Completed this week: 0 items, 0 points</strong></p><p>Both wave-1 templates reached review; nothing reached Done yet.</p><p><strong>Added this week</strong></p><ul><li><p>EHR-16 Duplicate patients created when MRN has leading zeros (3 pts), found in the dry-run</p></li></ul>',
  schedule:
    '<p>EHR Sprint 2 (Oct 5 – Oct 16): 0 of 19 points done. Sprint goal: Conversion dry-run and first templates.</p><p><strong>Milestones</strong></p><ul><li><p>Gate 3 · Execute review planned for Dec 4</p></li><li><p>Deliverable: Appointment conversion sign-off due Oct 30</p></li><li><p>Project target date: Jan 29</p></li></ul>',
  budget:
    '<p>Budget at completion: $480,000 (fixed fee).</p><p>Integration effort is tracking above estimate; see the cost risk in the RAID log.</p>',
  risks:
    '<p><strong>Top open risks</strong></p><ul><li><p>Duplicate patient records delay cutover — score 16 (High)</p></li><li><p>Integration estimate may be low — score 12 (Medium)</p></li></ul><p><strong>New or escalated this week</strong></p><p>No new or escalated risks this week.</p>',
  decisions: '<ul><li><p>Deliverable awaiting acceptance: Appointment conversion sign-off</p></li></ul>',
  next_steps:
    '<ul><li><p>Re-run the conversion dry-run once the MRN fix (EHR-16) is in.</p></li><li><p>Clinical lead review of the family-medicine template (EHR-9).</p></li><li><p>EHR-12 Confirm HL7 ADT feed endpoint with lab vendor</p></li></ul>',
};

/** Pulse seed: status history, commitments, the metrics archive and one published report. */
export function seedPulse(): PulseDb {
  const history: StatusChange[] = [];
  const items: WorkItem[] = ARCHIVED_ITEMS.map(
    ([n, sprintId, type, title, estimate, assignee, created, codes]) => {
      const id = archivedId(n);
      const changes = timeline(id, assignee, codes);
      history.push(...changes);
      return {
        id,
        projectId: 'p_ehr',
        number: n,
        key: `EHR-H${n}`,
        type,
        title,
        description: `<p>${title}.</p>`,
        status: changes[changes.length - 1].to,
        priority: 'medium',
        assigneeId: assignee,
        reporterId: 'u_lead',
        phaseId: ARCHIVED_SPRINTS.find((s) => s.id === sprintId)!.phaseId,
        sprintId,
        parentId: null,
        estimate,
        dueDate: null,
        labels: ['imported'],
        visibility: 'internal',
        acceptanceCriteria: [],
        position: n * 1000,
        createdAt: at(created, '08'),
        updatedAt: changes[changes.length - 1].at,
      };
    },
  );
  for (const [n, codes] of LIVE_HISTORY) history.push(...timeline(liveId(n), 'u_dev', codes));

  const { budget: _budget, ...client } = REPORT_1005;
  return {
    statusHistory: history,
    sprintCommitments: COMMITMENTS.map(([sprintId, day, itemIds]) => ({
      sprintId,
      itemIds,
      at: `${day}T09:00:00.000Z`,
    })),
    metricsArchive: { sprints: ARCHIVED_SPRINTS, items },
    statusReports: [
      {
        id: 'sr_ehr_1005',
        projectId: 'p_ehr',
        weekStart: '2026-10-05',
        weekEnd: '2026-10-09',
        status: 'published',
        rag: 'amber',
        ragReason: 'Conversion dry-run found duplicate patient records.',
        sections: REPORT_1005,
        shareBudget: false,
        authorId: 'u_lead',
        createdAt: '2026-10-09T13:00:00.000Z',
        updatedAt: '2026-10-09T16:40:00.000Z',
        publishedAt: '2026-10-09T17:00:00.000Z',
        publishedBy: 'u_lead',
        clientSections: {
          ...client,
          risks:
            '<p><strong>Top open risks</strong></p><ul><li><p>Duplicate patient records delay cutover — score 16 (High)</p></li></ul><p><strong>New or escalated this week</strong></p><p>No new or escalated risks this week.</p>',
          next_steps:
            '<ul><li><p>Re-run the conversion dry-run once the MRN fix (EHR-16) is in.</p></li><li><p>Clinical lead review of the family-medicine template (EHR-9).</p></li></ul>',
        },
        clientRagReason: 'Conversion dry-run found duplicate patient records.',
        removed: [
          { kind: 'budget', section: 'budget', label: 'Budget section (internal only)' },
          { kind: 'raid', section: 'risks', label: 'Risk: Integration estimate may be low' },
          {
            kind: 'item',
            section: 'next_steps',
            label: 'EHR-12 Confirm HL7 ADT feed endpoint with lab vendor',
          },
        ],
      },
    ],
  };
}
