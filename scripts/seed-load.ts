/**
 * KH-46 load generator: a deterministic 2×-scale dataset (CLAUDE.md §1 scale × 2).
 *
 *   - 120 projects (2 × 60 active projects), spread over the two demo client orgs;
 *   - one "big" project (key LOAD) with 20,000 work items (2 × 10,000 per project);
 *   - every other project with a configurable number of items;
 *   - realistic comments (about one per four items, some internal) and RAID entries per project.
 *
 * Two targets use the same shape and distributions:
 *   (a) the in-memory demo store: `KH_LOAD=1 npm start` calls `applyLoad(db, loadOptionsFromEnv())`
 *       (lib/data/memory.ts). Defaults: 120 projects, 20,000 items in LOAD, 40 items in each other
 *       project. Override with KH_LOAD_PROJECTS, KH_LOAD_ITEMS, KH_LOAD_OTHER_ITEMS.
 *   (b) Postgres: supabase/tests/load.sql builds the same distributions with generate_series
 *       (400,000 items in total by default), so loading needs no Node at all.
 *
 * Deterministic: the same options always give byte-identical output (seeded PRNG, fixed dates).
 * Pure and dependency-free (type imports only) so it also runs under
 * `node --experimental-strip-types scripts/seed-load.ts` (prints a summary).
 */
import type {
  Comment,
  GateCriterion,
  ItemStatus,
  ItemType,
  Phase,
  Priority,
  Project,
  ProjectMember,
  Sprint,
  WorkItem,
} from '../lib/domain/types';
import type { RaidEntry } from '../lib/domain/raid';

export interface LoadOptions {
  /** Generated projects, including the big one. */
  projects: number;
  /** Items in the big project (key LOAD). */
  bigItems: number;
  /** Items in each other generated project. */
  otherItems: number;
  /** PRNG seed. */
  seed: number;
}

export const DEFAULT_LOAD: LoadOptions = { projects: 120, bigItems: 20_000, otherItems: 40, seed: 46 };
export const BIG_PROJECT_KEY = 'LOAD';
export const BIG_PROJECT_ID = 'p_load_big';

export interface LoadData {
  projects: Project[];
  phases: Phase[];
  criteria: GateCriterion[];
  members: ProjectMember[];
  sprints: Sprint[];
  items: WorkItem[];
  comments: Comment[];
  raid: RaidEntry[];
}

/** Reads KH_LOAD_* overrides (memory mode). */
export function loadOptionsFromEnv(env: Record<string, string | undefined> = process.env): LoadOptions {
  const n = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : d;
  };
  return {
    projects: Math.max(1, n('KH_LOAD_PROJECTS', DEFAULT_LOAD.projects)),
    bigItems: n('KH_LOAD_ITEMS', DEFAULT_LOAD.bigItems),
    otherItems: n('KH_LOAD_OTHER_ITEMS', DEFAULT_LOAD.otherItems),
    seed: n('KH_LOAD_SEED', DEFAULT_LOAD.seed),
  };
}

/** mulberry32: tiny, fast, deterministic. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rnd: () => number, table: readonly (readonly [T, number])[]): T {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of table) if ((r -= w) < 0) return v;
  return table[table.length - 1][0];
}
const pickOne = <T>(rnd: () => number, xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

/** Shared distributions (load.sql mirrors these weights). */
export const STATUS_WEIGHTS: readonly (readonly [ItemStatus, number])[] = [
  ['backlog', 40],
  ['ready', 15],
  ['in_progress', 10],
  ['in_review', 7],
  ['client_review', 5],
  ['done', 15],
  ['accepted', 8],
];
export const TYPE_WEIGHTS: readonly (readonly [ItemType, number])[] = [
  ['epic', 1],
  ['feature', 4],
  ['story', 55],
  ['task', 25],
  ['bug', 15],
];
const PRIORITY_WEIGHTS: readonly (readonly [Priority, number])[] = [
  ['critical', 5],
  ['high', 20],
  ['medium', 50],
  ['low', 25],
];

const VERBS = ['Migrate', 'Validate', 'Configure', 'Build', 'Test', 'Reconcile', 'Document', 'Automate'];
const NOUNS = [
  'appointment feed',
  'billing export',
  'patient portal login',
  'lab results interface',
  'pharmacy order sync',
  'permit intake form',
  'inspection calendar',
  'audit trail report',
  'role-based access',
  'data conversion script',
  'cutover runbook',
  'training material',
];
const AREAS = ['clinic', 'county', 'finance', 'records', 'scheduling', 'reporting', 'integration'];
const COMMENT_BODIES = [
  'Reviewed with the client; acceptance criteria look complete.',
  'Blocked on vendor credentials, chasing today.',
  'Dry-run passed for the sample set, running the full set next.',
  'Can we split this into two stories before sprint planning?',
  'Internal: estimate looks light, flag it at stand-up.',
  'Demo went well. Waiting on sign-off from the clinical lead.',
];
const RISK_TITLES = [
  'Vendor interface delivered late',
  'Key SME unavailable during UAT',
  'Data quality issues in legacy export',
  'Budget pressure from change requests',
  'Regulatory review adds a review cycle',
];
const LEADS = ['u_lead', 'u_admin'];
const TEAM = ['u_dev', 'u_team', 'u_lead'];
const CLIENTS = ['org_peachtree', 'org_riverbend'];
const GATES = ['Mobilize', 'Plan', 'Execute', 'Accept', 'Transition'] as const;

const DAY = 86_400_000;
const BASE = Date.UTC(2026, 6, 1); // 1 Jul 2026, fixed for determinism
const isoDay = (offset: number) => new Date(BASE + offset * DAY).toISOString().slice(0, 10);
const isoAt = (offset: number) => new Date(BASE + offset * DAY).toISOString();

export function generateLoad(opts: LoadOptions = DEFAULT_LOAD): LoadData {
  const out: LoadData = {
    projects: [],
    phases: [],
    criteria: [],
    members: [],
    sprints: [],
    items: [],
    comments: [],
    raid: [],
  };
  for (let pi = 0; pi < opts.projects; pi++) {
    const rnd = prng(opts.seed * 1000 + pi);
    const big = pi === 0;
    const id = big ? BIG_PROJECT_ID : `p_load_${pi}`;
    const key = big ? BIG_PROJECT_KEY : `L${String(pi).padStart(3, '0')}`;
    const startOffset = Math.floor(rnd() * 60);
    const activeGate = 1 + Math.floor(rnd() * 4);
    const itemCount = big ? opts.bigItems : opts.otherItems;
    out.projects.push({
      id,
      key,
      name: big ? 'Load test — 20k item board' : `Load ${pickOne(rnd, AREAS)} programme ${pi}`,
      clientOrgId: CLIENTS[pi % CLIENTS.length],
      leadId: LEADS[pi % LEADS.length],
      startDate: isoDay(startOffset),
      targetDate: isoDay(startOffset + 180 + Math.floor(rnd() * 120)),
      methodology: pickOne(rnd, ['hybrid', 'scrum', 'kanban', 'waterfall'] as const),
      contractType: pickOne(rnd, ['fixed_fee', 'time_materials', 'retainer'] as const),
      bac: 50_000 + Math.floor(rnd() * 950) * 1000,
      description: `Generated load-test project ${key}.`,
      status: 'active',
      restricted: false,
      rag: weighted(rnd, [
        ['green', 6],
        ['amber', 3],
        ['red', 1],
      ] as const),
      estimateUnit: 'points',
      templateId: 'kdf-hybrid',
      nextItemNumber: itemCount + 1,
      createdAt: isoAt(startOffset),
    });
    for (const [userId, projectRole, allocationPct] of [
      ['u_lead', 'Delivery Lead', 10],
      ['u_dev', 'Engineer', 10],
      ['u_team', 'QA', 10],
    ] as const)
      out.members.push({ projectId: id, userId, projectRole, allocationPct });
    GATES.forEach((name, gi) => {
      const gate = gi + 1;
      const phaseId = `${id}_ph${gate}`;
      out.phases.push({
        id: phaseId,
        projectId: id,
        gate: gate as Phase['gate'],
        name,
        status: gate < activeGate ? 'approved' : gate === activeGate ? 'active' : 'not_started',
      });
      out.criteria.push({
        id: `${phaseId}_c0`,
        phaseId,
        text: `${name} exit criteria met`,
        done: gate < activeGate,
      });
    });
    const sprintCount = big ? 12 : 4;
    const sprintIds: string[] = [];
    for (let si = 0; si < sprintCount; si++) {
      const sid = `${id}_s${si + 1}`;
      sprintIds.push(sid);
      const s0 = startOffset + 30 + si * 14;
      out.sprints.push({
        id: sid,
        projectId: id,
        phaseId: `${id}_ph3`,
        name: `${key} Sprint ${si + 1}`,
        startDate: isoDay(s0),
        endDate: isoDay(s0 + 11),
        goal: `Increment ${si + 1}`,
        status: si < 4 ? 'completed' : si === 4 ? 'active' : 'planned',
        capacityHours: 200,
      });
    }
    const epics: string[] = [];
    for (let n = 1; n <= itemCount; n++) {
      const type = n <= 3 ? 'epic' : weighted(rnd, TYPE_WEIGHTS);
      const status = type === 'epic' ? 'in_progress' : weighted(rnd, STATUS_WEIGHTS);
      const itemId = `wi_${key.toLowerCase()}_${n}`;
      if (type === 'epic') epics.push(itemId);
      const title = `${pickOne(rnd, VERBS)} ${pickOne(rnd, NOUNS)} for ${pickOne(rnd, AREAS)} #${n}`;
      const updated = startOffset + Math.floor(rnd() * 90);
      out.items.push({
        id: itemId,
        projectId: id,
        number: n,
        key: `${key}-${n}`,
        type,
        title,
        description: `<p>${title}. Generated for load testing (${pickOne(rnd, AREAS)} workstream).</p>`,
        status,
        priority: weighted(rnd, PRIORITY_WEIGHTS),
        assigneeId: rnd() < 0.85 ? pickOne(rnd, TEAM) : null,
        reporterId: 'u_lead',
        phaseId: `${id}_ph3`,
        sprintId:
          type === 'epic' || type === 'feature' || status === 'backlog' ? null : pickOne(rnd, sprintIds),
        parentId: type !== 'epic' && epics.length && rnd() < 0.6 ? pickOne(rnd, epics) : null,
        estimate: type === 'epic' ? null : pickOne(rnd, [1, 2, 3, 5, 8, 13]),
        dueDate: rnd() < 0.2 ? isoDay(startOffset + 30 + Math.floor(rnd() * 150)) : null,
        labels: rnd() < 0.5 ? [pickOne(rnd, AREAS)] : [],
        visibility: rnd() < 0.7 ? 'shared' : 'internal',
        acceptanceCriteria: [],
        position: n * 1000,
        createdAt: isoAt(startOffset),
        updatedAt: isoAt(updated),
      });
      if (rnd() < 0.25)
        out.comments.push({
          id: `cm_${key.toLowerCase()}_${n}`,
          entityType: 'work_item',
          entityId: itemId,
          projectId: id,
          authorId: pickOne(rnd, TEAM),
          body: pickOne(rnd, COMMENT_BODIES),
          visibility: rnd() < 0.6 ? 'shared' : 'internal',
          mentions: [],
          createdAt: isoAt(updated),
        });
    }
    const raidCount = big ? 60 : 8;
    for (let r = 1; r <= raidCount; r++) {
      const kind = weighted(rnd, [
        ['risk', 5],
        ['issue', 2],
        ['assumption', 1],
        ['dependency', 1],
        ['decision', 1],
      ] as const);
      const created = startOffset + Math.floor(rnd() * 60);
      const p = 1 + Math.floor(rnd() * 5);
      const i = 1 + Math.floor(rnd() * 5);
      out.raid.push({
        id: `rd_${key.toLowerCase()}_${r}`,
        projectId: id,
        kind,
        title: `${pickOne(rnd, RISK_TITLES)} (${key}-${r})`,
        description: 'Generated RAID entry for load testing.',
        ownerId: pickOne(rnd, TEAM),
        status: rnd() < 0.8 ? 'open' : 'closed',
        visibility: rnd() < 0.5 ? 'shared' : 'internal',
        ...(kind === 'risk'
          ? {
              category: pickOne(rnd, ['schedule', 'cost', 'resource', 'technical', 'vendor'] as const),
              probability: p,
              impact: i,
              roam: 'owned' as const,
              mitigation: 'Tracked at the weekly risk review.',
            }
          : {}),
        ...(kind === 'issue' ? { severity: pickOne(rnd, ['critical', 'major', 'minor'] as const) } : {}),
        closureNote: null,
        linkedItemIds: [],
        createdBy: 'u_lead',
        createdAt: isoAt(created),
        updatedAt: isoAt(created + Math.floor(rnd() * 10)),
      });
    }
  }
  // Closed RAID entries need a closure note (the register rule); keep the data valid.
  for (const r of out.raid)
    if (r.status === 'closed')
      Object.assign(r, { closureNote: 'Closed after review.', closedAt: r.updatedAt });
  return out;
}

/** Appends the generated dataset to a store (memory mode). Returns the summary. */
export function applyLoad<
  D extends {
    projects: Project[];
    phases: Phase[];
    criteria: GateCriterion[];
    members: ProjectMember[];
    sprints: Sprint[];
    items: WorkItem[];
    comments: Comment[];
    raid: RaidEntry[];
  },
>(d: D, opts: LoadOptions = DEFAULT_LOAD) {
  const g = generateLoad(opts);
  for (const k of [
    'projects',
    'phases',
    'criteria',
    'members',
    'sprints',
    'items',
    'comments',
    'raid',
  ] as const)
    for (const row of g[k]) (d[k] as unknown[]).push(row);
  return summarize(g);
}

export function summarize(g: LoadData) {
  return {
    projects: g.projects.length,
    items: g.items.length,
    bigProjectItems: g.items.filter((i) => i.projectId === BIG_PROJECT_ID).length,
    comments: g.comments.length,
    raid: g.raid.length,
    sprints: g.sprints.length,
  };
}

// CLI: `node --experimental-strip-types scripts/seed-load.ts [projects] [bigItems] [otherItems]`
// prints the summary of the dataset the memory store would load. (Never true inside Next.)
if (typeof process !== 'undefined' && /seed-load\.ts$/.test(process.argv?.[1] ?? '')) {
  const [p, b, o] = process.argv.slice(2).map(Number);
  const opts = {
    ...DEFAULT_LOAD,
    ...(p ? { projects: p } : {}),
    ...(b ? { bigItems: b } : {}),
    ...(o ? { otherItems: o } : {}),
  };
  console.log(JSON.stringify({ options: opts, ...summarize(generateLoad(opts)) }, null, 2));
}
