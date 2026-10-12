import type {
  ActivityEvent,
  Comment,
  GateCriterion,
  ItemLink,
  ItemStatus,
  ItemType,
  Organization,
  Phase,
  Priority,
  Profile,
  Project,
  ProjectMember,
  Sprint,
  WorkItem,
  AuditEntry,
} from '../domain/types';
import { getTemplate } from '../domain/templates';
import { seedRaid } from './seed-raid';
import type { PlanningState } from '../domain/sprints';
import { datedEhrPhases, seedPlanning, SEED_TIMELINE_LINKS } from './seed-sprints';
import type { GateReview } from '../domain/gates';
import type { Deliverable } from '../domain/deliverables';
import { seedGates } from './seed-gates';
import { seedInsight, type InsightState } from './seed-insight';
import { seedPulse, type PulseDb } from './seed-pulse';
import { seedSignal } from './seed-signal';

export interface Db extends PulseDb {
  orgs: Organization[];
  profiles: Profile[];
  projects: Project[];
  members: ProjectMember[];
  phases: Phase[];
  criteria: GateCriterion[];
  sprints: Sprint[];
  items: WorkItem[];
  links: ItemLink[];
  comments: Comment[];
  activity: ActivityEvent[];
  audit: AuditEntry[];
  raid: ReturnType<typeof seedRaid>['raid'];
  notifications: ReturnType<typeof seedRaid>['notifications'];
  planning: PlanningState;
  gateReviews: GateReview[];
  deliverables: Deliverable[];
  insight: InsightState;
  signal: ReturnType<typeof seedSignal>['signal'];
}

export const DEMO_PROJECT_KEY = 'EHR';
const T0 = '2026-08-03T09:00:00.000Z';

export const ORGS: Organization[] = [
  { id: 'org_konnector', name: 'Konnector LLC', type: 'internal' },
  { id: 'org_peachtree', name: 'Peachtree Clinic Group', type: 'client' },
  { id: 'org_riverbend', name: 'Riverbend County IT', type: 'client' },
];

export const PROFILES: Profile[] = [
  {
    id: 'u_admin',
    orgId: 'org_konnector',
    name: 'Ada Okafor',
    email: 'ada@konnectortech.com',
    role: 'admin',
    mfaEnabled: true,
    usPerson: true,
    title: 'Delivery Director',
    costRate: 120,
    hoursPerWeek: 40,
    skills: ['Governance', 'PMP'],
    timezone: 'America/New_York',
  },
  {
    id: 'u_lead',
    orgId: 'org_konnector',
    name: 'Lara Bennett',
    email: 'lara@konnectortech.com',
    role: 'delivery_lead',
    mfaEnabled: true,
    usPerson: true,
    title: 'Delivery Lead',
    costRate: 105,
    hoursPerWeek: 40,
    skills: ['SAFe', 'EHR'],
    timezone: 'America/New_York',
  },
  {
    id: 'u_team',
    orgId: 'org_konnector',
    name: 'Tiara Mensah',
    email: 'tiara@konnectortech.com',
    role: 'team_member',
    mfaEnabled: true,
    usPerson: true,
    title: 'QA Engineer',
    costRate: 80,
    hoursPerWeek: 40,
    skills: ['QA', 'Playwright'],
    timezone: 'America/Chicago',
  },
  {
    id: 'u_dev',
    orgId: 'org_konnector',
    name: 'Adeoba Cole',
    email: 'adeoba@konnectortech.com',
    role: 'team_member',
    mfaEnabled: true,
    usPerson: true,
    title: 'Full-stack Engineer',
    costRate: 95,
    hoursPerWeek: 40,
    skills: ['TypeScript', 'Postgres'],
    timezone: 'America/New_York',
  },
  {
    id: 'u_assoc',
    orgId: 'org_konnector',
    name: 'Sam Rivera',
    email: 'sam@associates.konnectortech.com',
    role: 'associate',
    mfaEnabled: true,
    usPerson: false,
    title: 'Integration Associate',
    costRate: 70,
    hoursPerWeek: 30,
    skills: ['HL7', 'FHIR'],
    timezone: 'Europe/London',
  },
  {
    id: 'u_sponsor',
    orgId: 'org_peachtree',
    name: 'Grace Whitfield',
    email: 'grace@peachtreeclinic.example',
    role: 'client_sponsor',
    mfaEnabled: false,
    usPerson: true,
    title: 'COO',
  },
  {
    id: 'u_cmember',
    orgId: 'org_peachtree',
    name: 'Mo Haddad',
    email: 'mo@peachtreeclinic.example',
    role: 'client_member',
    mfaEnabled: false,
    usPerson: true,
    title: 'Clinical Lead',
  },
  {
    id: 'u_cviewer',
    orgId: 'org_peachtree',
    name: 'Vi Tran',
    email: 'vi@peachtreeclinic.example',
    role: 'client_viewer',
    mfaEnabled: false,
    usPerson: true,
    title: 'Board Observer',
  },
  {
    id: 'u_rsponsor',
    orgId: 'org_riverbend',
    name: 'Ola Adeyemi',
    email: 'ola@riverbend.example',
    role: 'client_sponsor',
    mfaEnabled: false,
    usPerson: true,
    title: 'CIO',
  },
];

export function buildPhases(projectId: string, templateId: string, activeGate: number) {
  const tpl = getTemplate(templateId);
  const phases: Phase[] = [];
  const criteria: GateCriterion[] = [];
  for (const p of tpl.phases) {
    const id = `${projectId}_ph${p.gate}`;
    phases.push({
      id,
      projectId,
      gate: p.gate,
      name: p.name,
      status: p.gate < activeGate ? 'approved' : p.gate === activeGate ? 'active' : 'not_started',
    });
    p.criteria.forEach((text, i) =>
      criteria.push({
        id: `${id}_c${i}`,
        phaseId: id,
        text,
        done: p.gate < activeGate,
        doneBy: p.gate < activeGate ? 'u_lead' : undefined,
        doneAt: p.gate < activeGate ? T0 : undefined,
      }),
    );
  }
  return { phases, criteria };
}

type ItemSeed = [
  ItemType,
  string,
  ItemStatus,
  Priority,
  string | null,
  number | null,
  'internal' | 'shared',
  string[]?,
];

const EHR_ITEMS: ItemSeed[] = [
  ['epic', 'Patient scheduling migration', 'in_progress', 'high', 'u_lead', null, 'shared'],
  ['epic', 'Clinical documentation go-live', 'in_progress', 'high', 'u_lead', null, 'shared'],
  ['epic', 'Integrations: labs and pharmacy', 'ready', 'medium', 'u_assoc', null, 'internal'],
  ['feature', 'Appointment data conversion', 'in_progress', 'high', 'u_dev', 13, 'shared'],
  ['feature', 'Provider template build', 'in_review', 'medium', 'u_dev', 8, 'shared'],
  [
    'story',
    'Map legacy appointment types to new visit types',
    'done',
    'high',
    'u_dev',
    5,
    'shared',
    ['data'],
  ],
  [
    'story',
    'Dry-run conversion of 12 months of appointments',
    'in_progress',
    'critical',
    'u_dev',
    8,
    'shared',
    ['data', 'cutover'],
  ],
  [
    'story',
    'Reconcile converted appointments against source report',
    'ready',
    'high',
    'u_team',
    5,
    'shared',
    ['data'],
  ],
  [
    'story',
    'Build family-medicine progress note template',
    'client_review',
    'medium',
    'u_dev',
    3,
    'shared',
    ['templates'],
  ],
  [
    'story',
    'Build pediatrics well-child template',
    'in_review',
    'medium',
    'u_dev',
    3,
    'shared',
    ['templates'],
  ],
  [
    'story',
    'Train super-users on documentation workflow',
    'backlog',
    'medium',
    'u_lead',
    5,
    'shared',
    ['training'],
  ],
  [
    'task',
    'Confirm HL7 ADT feed endpoint with lab vendor',
    'in_progress',
    'high',
    'u_assoc',
    2,
    'internal',
    ['vendor'],
  ],
  [
    'task',
    'Pharmacy e-prescribing certification paperwork',
    'ready',
    'medium',
    'u_assoc',
    3,
    'internal',
    ['vendor'],
  ],
  ['task', 'Set up UAT environment refresh schedule', 'done', 'medium', 'u_team', 2, 'internal'],
  ['task', 'Write cutover runbook draft', 'backlog', 'high', 'u_lead', 5, 'internal', ['cutover']],
  [
    'bug',
    'Duplicate patients created when MRN has leading zeros',
    'in_progress',
    'critical',
    'u_dev',
    3,
    'shared',
    ['data'],
  ],
  [
    'bug',
    'Template signature block missing credentials',
    'ready',
    'low',
    'u_dev',
    1,
    'shared',
    ['templates'],
  ],
  ['bug', 'Converted recurring appointments lose end date', 'backlog', 'high', null, 2, 'internal', ['data']],
  [
    'change_request',
    'Add telehealth visit type to conversion scope',
    'backlog',
    'medium',
    'u_lead',
    5,
    'shared',
  ],
  ['client_request', 'Can we keep the old fax cover sheet layout?', 'backlog', 'low', null, null, 'shared'],
  ['story', 'Load provider schedules for first 30 days', 'ready', 'high', 'u_team', 3, 'shared', ['cutover']],
  ['story', 'Accept go-live readiness checklist', 'backlog', 'high', 'u_lead', 2, 'shared', ['cutover']],
  ['task', 'Internal estimate review for integration effort', 'done', 'low', 'u_lead', 1, 'internal'],
  [
    'story',
    'Clinic front-desk check-in workflow walkthrough',
    'accepted',
    'medium',
    'u_team',
    3,
    'shared',
    ['training'],
  ],
];

export function buildSeed(): Db {
  const projects: Project[] = [
    {
      id: 'p_ehr',
      key: DEMO_PROJECT_KEY,
      name: 'Demo — Clinic EHR Go-Live',
      clientOrgId: 'org_peachtree',
      leadId: 'u_lead',
      startDate: '2026-08-03',
      targetDate: '2027-01-29',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 480000,
      description: 'Migrate Peachtree Clinic Group to a new EHR and support go-live across four clinics.',
      status: 'active',
      restricted: false,
      rag: 'amber',
      ragReason: 'Conversion dry-run found duplicate patient records.',
      estimateUnit: 'points',
      templateId: 'kdf-hybrid',
      nextItemNumber: EHR_ITEMS.length + 1,
      createdAt: T0,
    },
    {
      id: 'p_rvb',
      key: 'RVB',
      name: 'Riverbend Permit Portal',
      clientOrgId: 'org_riverbend',
      leadId: 'u_lead',
      startDate: '2026-09-14',
      targetDate: '2027-04-30',
      methodology: 'scrum',
      contractType: 'time_materials',
      bac: 310000,
      description: 'Online building-permit applications and inspections scheduling for Riverbend County.',
      status: 'active',
      restricted: true,
      rag: 'green',
      estimateUnit: 'points',
      templateId: 'kdf-hybrid',
      nextItemNumber: 4,
      createdAt: '2026-09-14T09:00:00.000Z',
    },
    {
      id: 'p_psr',
      key: 'PSR',
      name: 'Peachtree Support Retainer',
      clientOrgId: 'org_peachtree',
      leadId: 'u_admin',
      startDate: '2026-06-01',
      targetDate: '2027-05-31',
      methodology: 'kanban',
      contractType: 'retainer',
      bac: 96000,
      description: 'Monthly support retainer for Peachtree’s practice-management system.',
      status: 'active',
      restricted: false,
      rag: 'green',
      estimateUnit: 'hours',
      templateId: 'kanban-retainer',
      nextItemNumber: 3,
      createdAt: '2026-06-01T09:00:00.000Z',
    },
  ];

  const members: ProjectMember[] = [
    { projectId: 'p_ehr', userId: 'u_lead', projectRole: 'Delivery Lead', allocationPct: 60 },
    { projectId: 'p_ehr', userId: 'u_dev', projectRole: 'Engineer', allocationPct: 80 },
    { projectId: 'p_ehr', userId: 'u_team', projectRole: 'QA', allocationPct: 50 },
    { projectId: 'p_ehr', userId: 'u_assoc', projectRole: 'Integration', allocationPct: 100 },
    { projectId: 'p_rvb', userId: 'u_lead', projectRole: 'Delivery Lead', allocationPct: 40 },
    { projectId: 'p_rvb', userId: 'u_dev', projectRole: 'Engineer', allocationPct: 20 },
    { projectId: 'p_psr', userId: 'u_team', projectRole: 'Support', allocationPct: 30 },
  ];

  const ehr = buildPhases('p_ehr', 'kdf-hybrid', 3);
  const rvb = buildPhases('p_rvb', 'kdf-hybrid', 2);
  const psr = buildPhases('p_psr', 'kanban-retainer', 3);

  const sprints: Sprint[] = [
    {
      id: 's_ehr1',
      projectId: 'p_ehr',
      phaseId: 'p_ehr_ph3',
      name: 'EHR Sprint 1',
      startDate: '2026-09-21',
      endDate: '2026-10-02',
      goal: 'Appointment mapping complete',
      status: 'completed',
      capacityHours: 220,
    },
    {
      id: 's_ehr2',
      projectId: 'p_ehr',
      phaseId: 'p_ehr_ph3',
      name: 'EHR Sprint 2',
      startDate: '2026-10-05',
      endDate: '2026-10-16',
      goal: 'Conversion dry-run and first templates',
      status: 'active',
      capacityHours: 220,
    },
    {
      id: 's_ehr3',
      projectId: 'p_ehr',
      phaseId: 'p_ehr_ph3',
      name: 'EHR Sprint 3',
      startDate: '2026-10-19',
      endDate: '2026-10-30',
      goal: 'Reconcile and train',
      status: 'planned',
      capacityHours: 200,
    },
  ];

  const items: WorkItem[] = EHR_ITEMS.map(
    ([type, title, status, priority, assignee, estimate, visibility, labels], i) => {
      const n = i + 1;
      const parentId =
        type === 'feature'
          ? n === 4
            ? 'wi_ehr_1'
            : 'wi_ehr_2'
          : type === 'story' && labels?.includes('data')
            ? 'wi_ehr_4'
            : type === 'story' && labels?.includes('templates')
              ? 'wi_ehr_5'
              : null;
      const sprintId = ['done', 'accepted'].includes(status)
        ? 's_ehr1'
        : ['in_progress', 'in_review', 'client_review'].includes(status)
          ? 's_ehr2'
          : status === 'ready'
            ? 's_ehr3'
            : null;
      return {
        id: `wi_ehr_${n}`,
        projectId: 'p_ehr',
        number: n,
        key: `EHR-${n}`,
        type,
        title,
        description: type === 'epic' ? `<p>${title} across all four clinics.</p>` : `<p>${title}.</p>`,
        status,
        priority,
        assigneeId: assignee,
        reporterId: 'u_lead',
        phaseId: 'p_ehr_ph3',
        sprintId: type === 'epic' || type === 'feature' ? null : sprintId,
        parentId,
        estimate,
        dueDate: n % 4 === 0 ? '2026-10-30' : null,
        labels: labels ?? [],
        visibility,
        acceptanceCriteria:
          type === 'story'
            ? [
                {
                  id: `ac_${n}_1`,
                  text: 'Demonstrated to the clinical lead',
                  status: status === 'accepted' ? 'accepted' : 'pending',
                },
                {
                  id: `ac_${n}_2`,
                  text: 'No open critical defects',
                  status: status === 'accepted' ? 'accepted' : 'pending',
                },
              ]
            : [],
        position: n * 1000,
        createdAt: T0,
        updatedAt: T0,
      };
    },
  );

  const extra: [string, string, ItemType, ItemStatus, 'internal' | 'shared'][] = [
    ['p_rvb', 'RVB', 'epic', 'backlog', 'shared'],
    ['p_rvb', 'RVB', 'story', 'ready', 'shared'],
    ['p_rvb', 'RVB', 'task', 'in_progress', 'internal'],
    ['p_psr', 'PSR', 'bug', 'in_progress', 'shared'],
    ['p_psr', 'PSR', 'task', 'backlog', 'internal'],
  ];
  const titles = [
    'Permit application intake',
    'Applicant can upload site plans',
    'Security baseline for county network',
    'Claims export fails on month end',
    'Quarterly patch window planning',
  ];
  const counters: Record<string, number> = {};
  extra.forEach(([pid, key, type, status, visibility], i) => {
    const n = (counters[key] = (counters[key] ?? 0) + 1);
    items.push({
      id: `wi_${key.toLowerCase()}_${n}`,
      projectId: pid,
      number: n,
      key: `${key}-${n}`,
      type,
      title: titles[i],
      description: `<p>${titles[i]}.</p>`,
      status,
      priority: 'medium',
      assigneeId: 'u_dev',
      reporterId: 'u_lead',
      phaseId: `${pid}_ph${pid === 'p_rvb' ? 2 : 3}`,
      sprintId: null,
      parentId: null,
      estimate: 3,
      dueDate: null,
      labels: [],
      visibility,
      acceptanceCriteria: [],
      position: n * 1000,
      createdAt: T0,
      updatedAt: T0,
    });
  });

  const comments: Comment[] = [
    {
      id: 'cm_1',
      entityType: 'work_item',
      entityId: 'wi_ehr_7',
      projectId: 'p_ehr',
      authorId: 'u_dev',
      body: 'Dry-run is 70% through. Seeing duplicates on MRNs with leading zeros, logged as EHR-16.',
      visibility: 'shared',
      mentions: [],
      createdAt: '2026-10-08T14:00:00.000Z',
    },
    {
      id: 'cm_2',
      entityType: 'work_item',
      entityId: 'wi_ehr_7',
      projectId: 'p_ehr',
      authorId: 'u_lead',
      body: 'Internal: we may need two extra days; hold off telling the client until Thursday’s re-run.',
      visibility: 'internal',
      mentions: ['u_dev'],
      createdAt: '2026-10-08T15:10:00.000Z',
    },
    {
      id: 'cm_3',
      entityType: 'work_item',
      entityId: 'wi_ehr_9',
      projectId: 'p_ehr',
      authorId: 'u_cmember',
      body: 'Template looks good. Can the plan section default to expanded?',
      visibility: 'shared',
      mentions: [],
      createdAt: '2026-10-09T10:00:00.000Z',
    },
  ];

  const links: ItemLink[] = [{ id: 'ln_1', fromId: 'wi_ehr_16', toId: 'wi_ehr_7', type: 'blocks' }];

  const activity: ActivityEvent[] = [
    {
      id: 'ac_1',
      projectId: 'p_ehr',
      actorId: 'u_lead',
      action: 'gate.approved',
      detail: 'Plan gate approved by Grace Whitfield',
      at: '2026-09-18T16:00:00.000Z',
    },
    {
      id: 'ac_2',
      projectId: 'p_ehr',
      itemId: 'wi_ehr_6',
      actorId: 'u_dev',
      action: 'item.status',
      detail: 'EHR-6 moved to Done',
      at: '2026-10-01T12:00:00.000Z',
    },
    {
      id: 'ac_3',
      projectId: 'p_ehr',
      itemId: 'wi_ehr_24',
      actorId: 'u_sponsor',
      action: 'item.accepted',
      detail: 'EHR-24 accepted by Grace Whitfield',
      at: '2026-10-02T09:30:00.000Z',
    },
  ];

  return {
    orgs: structuredClone(ORGS),
    profiles: structuredClone(PROFILES),
    projects,
    members,
    phases: [...datedEhrPhases(ehr.phases), ...rvb.phases, ...psr.phases],
    criteria: [...ehr.criteria, ...rvb.criteria, ...psr.criteria],
    sprints,
    items,
    links: [...links, ...SEED_TIMELINE_LINKS],
    comments,
    activity,
    audit: [],
    ...seedRaid(),
    planning: seedPlanning(),
    ...seedGates(),
    ...seedInsight(),
    ...seedPulse(),
    ...seedSignal(items, comments),
  };
}
