import postgres from 'postgres';
import type { ItemFilters, ItemPatch, ProjectSummary, Repo, SearchResult } from './repo';
import type {
  AcceptanceCriterion,
  ActivityEvent,
  Comment,
  GateCriterion,
  Organization,
  Phase,
  Profile,
  Project,
  ProjectMember,
  Session,
  Sprint,
  WorkItem,
} from '../domain/types';
import { ForbiddenError, NotFoundError, ReauthRequiredError, ValidationError } from './errors';
import {
  canComment,
  canCreateProject,
  canEditItems,
  canSeeClientList,
  isClientRole,
} from '../domain/permissions';
import { STATUS_LABEL } from '../domain/workflow';
import { GATE_NAMES } from '../domain/templates';
import { DEMO_PROJECT_KEY } from './seed';

/**
 * Postgres-backed Repo (porsager/postgres). Every call runs in its own transaction as the
 * signed-in user: `set local role authenticated` plus the Supabase JWT claim settings, so
 * Row Level Security in supabase/migrations is the real enforcer, exactly as under Supabase.
 * Visibility filtering is NOT re-implemented here; app-level checks only exist where the demo
 * store raises a friendlier ForbiddenError message first.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;
export type Sql = postgres.Sql<any>;
export type Tx = postgres.TransactionSql<any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): boolean => typeof v === 'string' && UUID_RE.test(v);
/** Never matches a row; used where a non-uuid id is passed so the query simply finds nothing. */
export const NO_ID = '00000000-0000-0000-0000-000000000000';
export const uuidOr = (v: string) => (isUuid(v) ? v : NO_ID);
export const uuidOrNull = (v: string | null | undefined) => (v == null || v === '' ? null : uuidOr(v));

/** Postgres text[] literal. Passed as a string param so it never depends on fetched array types. */
export const textArray = (xs: readonly string[]) =>
  `{${xs.map((x) => `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const num = (v: unknown) => (v == null ? null : Number(v));
export const opt = <T>(v: T | null | undefined) => (v == null ? undefined : v);

/**
 * Connection options for a DATABASE_URL. Besides normal URLs this accepts libpq-style socket
 * URLs (`postgresql://user@/db?host=/var/run/postgresql&port=5432`), which postgres.js can't parse.
 */
export function connectionOptions(url: string): { url: string; host?: string; port?: number } {
  const m = /^(postgres(?:ql)?:\/\/)([^/?]*)(\/[^?]*)?(?:\?(.*))?$/.exec(url);
  if (!m) return { url };
  const params = new URLSearchParams(m[4] ?? '');
  const socket = params.get('host');
  if (!socket || !socket.startsWith('/')) return { url };
  const port = Number(params.get('port') ?? 5432);
  params.delete('host');
  params.delete('port');
  const at = m[2].lastIndexOf('@');
  const userinfo = at >= 0 ? m[2].slice(0, at + 1) : '';
  const qs = params.toString();
  return {
    url: `${m[1]}${userinfo}localhost:${port}${m[3] ?? '/'}${qs ? `?${qs}` : ''}`,
    host: socket,
    port,
  };
}

/** Creates a pool. `prepare: false` so it works behind Supabase's transaction-mode pooler. */
export function createSql(url: string, max = 10): Sql {
  const { url: u, host, port } = connectionOptions(url);
  return postgres(u, {
    ...(host ? { host, port } : {}),
    max,
    prepare: false,
    idle_timeout: 20,
    onnotice: () => {},
    types: {
      // Keep dates as YYYY-MM-DD and timestamps as ISO strings, matching lib/domain/types.ts.
      day: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      instant: {
        to: 1184,
        from: [1184, 1114],
        serialize: (x: Date | string) => (x instanceof Date ? x.toISOString() : x),
        parse: (x: string) => new Date(x).toISOString(),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
/** Maps Postgres errors to domain errors (42501 → Forbidden, P0002 → NotFound, rule checks → Validation). */
export function mapPgError(e: unknown): unknown {
  if (!(e instanceof postgres.PostgresError)) return e;
  switch (e.code) {
    case '42501':
      return new ForbiddenError(
        /row-level security/i.test(e.message) ? 'You do not have permission to do that.' : e.message,
      );
    case 'P0002':
      if (/project/i.test(e.message)) return new NotFoundError('Project not found');
      // Domain RPCs (0005): "gate review not found", "phase not found", "deliverable not found"…
      if (/^(gate review|phase|deliverable|criterion|profile) not found$/i.test(e.message))
        return new NotFoundError(e.message[0].toUpperCase() + e.message.slice(1));
      return new NotFoundError('Item not found');
    case '28000':
      // has_fresh_reauth() failed inside decide_gate / decide_deliverable_criterion.
      return new ReauthRequiredError();
    case '22023':
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
    case '23503':
      return new ValidationError(e.message);
    case '23505':
      return new ValidationError('That value is already used.');
    default:
      return e;
  }
}

export interface AsUserOptions {
  /**
   * Runs first, as the server's own login role (before `set local role authenticated`), in the
   * same transaction. Only for server-verified facts such as `record_reauth()`; never user input.
   */
  privileged?: (tx: Tx) => Promise<unknown>;
  /** Extra JWT claims (e.g. `aal`), as Supabase would put them in `request.jwt.claims`. */
  claims?: Record<string, string>;
}

/** Runs fn in a transaction as the session user, with RLS applied. */
export async function asUser<T>(
  sql: Sql,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: AsUserOptions = {},
): Promise<T> {
  try {
    return (await sql.begin(async (tx) => {
      if (opts.privileged) await opts.privileged(tx);
      await tx`set local role authenticated`;
      const claims = JSON.stringify({ ...opts.claims, sub: userId, role: 'authenticated' });
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true),
                      set_config('request.jwt.claims', ${claims}, true)`;
      return fn(tx);
    })) as T;
  } catch (e) {
    throw mapPgError(e);
  }
}

/**
 * System jobs (e.g. the stale-issue cron) with no signed-in user: one transaction as
 * `service_role`, which Supabase grants BYPASSRLS. Never used for a user request.
 */
export async function asService<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return (await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      await tx`select set_config('request.jwt.claim.sub', '', true),
                      set_config('request.jwt.claims', '{"role":"service_role"}', true)`;
      return fn(tx);
    })) as T;
  } catch (e) {
    throw mapPgError(e);
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------
export const toOrg = (r: Row): Organization => ({
  id: r.id,
  name: r.name,
  type: r.type,
  ...(r.logo_url ? { logoUrl: r.logo_url } : {}),
});

export const toProfile = (r: Row): Profile => {
  const p: Profile = {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    email: r.email,
    role: r.role,
    mfaEnabled: r.mfa_enabled,
    usPerson: r.us_person,
    title: opt(r.title),
    skills: r.skills ?? [],
    timezone: opt(r.timezone),
    hoursPerWeek: opt(num(r.hours_per_week)),
  };
  // profile_rates is admin-only under RLS; anyone else gets null and no costRate key at all.
  if (r.cost_rate != null) p.costRate = Number(r.cost_rate);
  return p;
};

export const toProject = (r: Row): Project => ({
  id: r.id,
  key: r.key,
  name: r.name,
  clientOrgId: r.client_org_id,
  leadId: r.lead_id,
  startDate: r.start_date ?? '',
  targetDate: r.target_date ?? '',
  methodology: r.methodology,
  contractType: r.contract_type,
  // project_financials is hidden by RLS from non-financial roles: missing means 0.
  bac: Number(r.bac ?? 0),
  description: r.description,
  status: r.status,
  restricted: r.restricted,
  rag: r.rag,
  ragReason: opt(r.rag_reason),
  estimateUnit: r.estimate_unit,
  templateId: r.template_id,
  nextItemNumber: r.next_item_number,
  createdAt: r.created_at,
  deletedAt: r.deleted_at ?? null,
});

export const toPhase = (r: Row): Phase => ({
  id: r.id,
  projectId: r.project_id,
  gate: r.gate,
  name: r.name,
  status: r.status,
  startDate: opt(r.start_date),
  endDate: opt(r.end_date),
});

export const toCriterion = (r: Row): GateCriterion => ({
  id: r.id,
  phaseId: r.phase_id,
  text: r.text,
  done: r.done,
  doneBy: opt(r.done_by),
  doneAt: opt(r.done_at),
});

export const toSprint = (r: Row): Sprint => ({
  id: r.id,
  projectId: r.project_id,
  phaseId: r.phase_id ?? '',
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  goal: r.goal,
  status: r.status,
  capacityHours: opt(num(r.capacity_hours)),
});

export const toMember = (r: Row): ProjectMember => ({
  projectId: r.project_id,
  userId: r.user_id,
  projectRole: r.project_role,
  allocationPct: Number(r.allocation_pct),
});

export const toAc = (r: Row): AcceptanceCriterion => ({
  id: r.id,
  text: r.text,
  status: r.status,
  decidedBy: opt(r.decided_by),
  decidedAt: opt(r.decided_at),
  note: opt(r.note),
});

export const toItem = (r: Row, acs: AcceptanceCriterion[] = []): WorkItem => ({
  id: r.id,
  projectId: r.project_id,
  number: r.number,
  key: r.key,
  type: r.type,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  assigneeId: r.assignee_id ?? null,
  reporterId: r.reporter_id,
  phaseId: r.phase_id ?? null,
  sprintId: r.sprint_id ?? null,
  parentId: r.parent_id ?? null,
  estimate: num(r.estimate),
  dueDate: r.due_date ?? null,
  labels: r.labels ?? [],
  visibility: r.visibility,
  acceptanceCriteria: acs,
  position: Number(r.position),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at ?? null,
});

export const toComment = (r: Row): Comment => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  projectId: r.project_id,
  authorId: r.author_id,
  body: r.body,
  visibility: r.visibility,
  mentions: r.mentions ?? [],
  createdAt: r.created_at,
});

export const toActivity = (r: Row): ActivityEvent => ({
  id: r.id,
  projectId: r.project_id,
  itemId: opt(r.item_id),
  actorId: r.actor_id ?? '',
  action: r.action,
  detail: r.detail,
  at: r.at,
});

// ---------------------------------------------------------------------------
// Query helpers (all run inside asUser, so RLS applies)
// ---------------------------------------------------------------------------
export const ITEM_COLS = (tx: Tx) => tx`
  w.id, w.project_id, w.number, w.key, w.type, w.title, w.description, w.status, w.priority,
  w.assignee_id, w.reporter_id, w.phase_id, w.sprint_id, w.parent_id, w.estimate, w.due_date,
  w.labels, w.visibility, w.position, w.created_at, w.updated_at, w.deleted_at`;

export async function findProject(tx: Tx, idOrKey: string): Promise<Project> {
  const rows = await tx`
    select p.*, f.bac from public.projects p
    left join public.project_financials f on f.project_id = p.id
    where ${isUuid(idOrKey) ? tx`p.id = ${idOrKey}` : tx`p.key = ${idOrKey.toUpperCase()}`}`;
  if (!rows.length) throw new NotFoundError('Project not found');
  return toProject(rows[0]);
}

export async function withCriteria(tx: Tx, rows: Row[]): Promise<WorkItem[]> {
  if (!rows.length) return [];
  const acs = await tx`
    select * from public.acceptance_criteria
    where item_id in (select unnest(${textArray(rows.map((r) => r.id))}::uuid[]))
    order by position, id`;
  const by = new Map<string, AcceptanceCriterion[]>();
  for (const a of acs) by.set(a.item_id, [...(by.get(a.item_id) ?? []), toAc(a)]);
  return rows.map((r) => toItem(r, by.get(r.id) ?? []));
}

export async function findItem(tx: Tx, idOrKey: string): Promise<WorkItem> {
  const rows = await tx`
    select ${ITEM_COLS(tx)} from public.work_items w
    where w.deleted_at is null
      and ${isUuid(idOrKey) ? tx`w.id = ${idOrKey}` : tx`w.key = ${idOrKey.toUpperCase()}`}`;
  if (!rows.length) throw new NotFoundError('Item not found');
  return (await withCriteria(tx, rows))[0];
}

export async function logActivity(
  tx: Tx,
  s: Session,
  projectId: string,
  action: string,
  detail: string,
  visibility: 'internal' | 'shared',
  itemId?: string,
) {
  await tx`
    insert into public.activity (project_id, item_id, actor_id, action, detail, visibility)
    values (${projectId}, ${itemId ?? null}, ${s.user.id}, ${action}, ${detail}, ${visibility})`;
}

export async function audit(
  tx: Tx,
  s: Session,
  projectId: string | null,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  await tx`
    insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
    values (${s.user.id}, ${projectId}, ${action}, ${entity}, ${entityId},
            ${before === undefined ? null : JSON.stringify(before)}::jsonb,
            ${after === undefined ? null : JSON.stringify(after)}::jsonb)`;
}

function filterSql(tx: Tx, f: ItemFilters) {
  const parts = [];
  if (f.projectId) parts.push(tx`and w.project_id = ${uuidOr(f.projectId)}`);
  if (f.type?.length) parts.push(tx`and w.type::text = any(${textArray(f.type)}::text[])`);
  if (f.status?.length) parts.push(tx`and w.status::text = any(${textArray(f.status)}::text[])`);
  if (f.assigneeId?.length)
    parts.push(tx`and (w.assignee_id::text = any(${textArray(f.assigneeId)}::text[])
                       or (w.assignee_id is null and 'unassigned' = any(${textArray(f.assigneeId)}::text[])))`);
  if (f.label?.length) parts.push(tx`and w.labels && ${textArray(f.label)}::text[]`);
  if (f.phaseId) parts.push(tx`and w.phase_id = ${uuidOr(f.phaseId)}`);
  if (f.sprintId === null) parts.push(tx`and w.sprint_id is null`);
  else if (f.sprintId !== undefined) parts.push(tx`and w.sprint_id = ${uuidOr(f.sprintId)}`);
  if (f.visibility) parts.push(tx`and w.visibility = ${f.visibility}`);
  if (f.updatedSince) parts.push(tx`and w.updated_at >= ${f.updatedSince}::timestamptz`);
  const q = f.q?.trim();
  if (q)
    parts.push(tx`and (w.search_vector @@ websearch_to_tsquery('english', ${q})
                       or lower(w.key) = lower(${q}))`);
  return parts.reduce((acc, p) => tx`${acc} ${p}`, tx``);
}

const ITEM_PATCH_COLUMNS: Partial<Record<keyof ItemPatch, string>> = {
  title: 'title',
  description: 'description',
  type: 'type',
  priority: 'priority',
  assigneeId: 'assignee_id',
  phaseId: 'phase_id',
  sprintId: 'sprint_id',
  parentId: 'parent_id',
  estimate: 'estimate',
  dueDate: 'due_date',
  labels: 'labels',
  visibility: 'visibility',
  position: 'position',
};
const UUID_COLUMNS = new Set(['assignee_id', 'phase_id', 'sprint_id', 'parent_id']);

async function saveCriteria(tx: Tx, item: WorkItem, list: AcceptanceCriterion[]) {
  const keep = list.filter((a) => isUuid(a.id)).map((a) => a.id);
  await tx`
    delete from public.acceptance_criteria
    where item_id = ${item.id} and not (id = any(${textArray(keep)}::uuid[]))`;
  for (const [i, a] of list.entries()) {
    const fields = {
      text: a.text,
      status: a.status,
      note: a.note ?? null,
      position: i + 1,
    };
    const updated = isUuid(a.id)
      ? await tx`update public.acceptance_criteria set ${tx(fields)} where id = ${a.id} and item_id = ${item.id} returning id`
      : [];
    if (!updated.length)
      await tx`insert into public.acceptance_criteria ${tx({ ...fields, project_id: item.projectId, item_id: item.id })}`;
  }
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------
export function createPostgresRepo(sql: Sql): Repo {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  async function people(tx: Tx): Promise<Profile[]> {
    const rows = await tx`
      select p.*, r.cost_rate from public.profiles p
      left join public.profile_rates r on r.profile_id = p.id
      order by p.name`;
    return rows.map(toProfile);
  }

  async function updateOne(tx: Tx, s: Session, id: string, patch: ItemPatch): Promise<WorkItem> {
    const item = await findItem(tx, id);
    const { offlineAcceptanceNote, acceptanceCriteria, ...fields } = patch;
    const client = isClientRole(s.user.role);
    const onlyStatus = Object.keys(fields).every((k) => k === 'status' || k === 'position');
    if (!canEditItems(s.user) && !(client && onlyStatus && !acceptanceCriteria))
      throw new ForbiddenError('You cannot edit this item.');

    const set: Row = {};
    const changed: string[] = [];
    // Clients never write work_items directly (RLS): their board position is not persisted.
    if (!client) {
      for (const [k, col] of Object.entries(ITEM_PATCH_COLUMNS)) {
        const v = (fields as Row)[k];
        if (v === undefined || col === 'labels') continue;
        set[col!] = UUID_COLUMNS.has(col!) ? uuidOrNull(v) : v;
        if (k !== 'position') changed.push(k);
      }
      if (Object.keys(set).length) await tx`update public.work_items set ${tx(set)} where id = ${item.id}`;
      if (fields.labels) {
        await tx`update public.work_items set labels = ${textArray(fields.labels)}::text[] where id = ${item.id}`;
        changed.push('labels');
      }
      if (acceptanceCriteria) {
        await saveCriteria(tx, item, acceptanceCriteria);
        changed.push('acceptanceCriteria');
      }
    }

    // Status always goes through transition_work_item(): it enforces the Accepted rule and
    // writes the audit entry and the activity event.
    if (fields.status && fields.status !== item.status)
      await tx`select 1 from public.transition_work_item(${item.id}::uuid,
                 ${fields.status}::public.item_status, ${offlineAcceptanceNote ?? null}::text)`;
    else if (changed.length)
      await logActivity(
        tx,
        s,
        item.projectId,
        'item.updated',
        `${item.key}: ${changed.join(', ')} updated`,
        fields.visibility ?? item.visibility,
        item.id,
      );
    if (!client && fields.visibility && fields.visibility !== item.visibility)
      await audit(
        tx,
        s,
        item.projectId,
        'visibility.change',
        'work_item',
        item.id,
        item.visibility,
        fields.visibility,
      );
    return findItem(tx, item.id);
  }

  return {
    async listOrgs(s) {
      return run(s, async (tx) => {
        const rows = (await tx`select * from public.organizations order by type, name`).map(toOrg);
        // RLS lets associates read the client org of their projects (for the project header),
        // but the client list itself is not theirs to browse (canSeeClientList).
        return isClientRole(s.user.role) || canSeeClientList(s.user)
          ? rows
          : rows.filter((o) => o.type === 'internal');
      });
    },

    async listPeople(s) {
      return run(s, people);
    },

    async listProjects(s) {
      return run(s, async (tx) => {
        const rows = await tx`
          select p.*, f.bac, o.name as client_name, l.name as lead_name,
            cur.gate as current_gate,
            coalesce(st.items, 0)::int as item_count,
            coalesce(st.work, 0)::int as work_count,
            coalesce(st.done, 0)::int as done_count,
            coalesce(st.critical, 0)::int as open_critical,
            ns.name as next_sprint_name, ns.end_date as next_sprint_end
          from public.projects p
          left join public.project_financials f on f.project_id = p.id
          left join public.organizations o on o.id = p.client_org_id
          left join public.profiles l on l.id = p.lead_id
          left join lateral (
            select count(*) as items,
                   count(*) filter (where w.type not in ('epic', 'feature')) as work,
                   count(*) filter (where w.type not in ('epic', 'feature')
                                      and w.status in ('done', 'accepted')) as done,
                   count(*) filter (where w.priority = 'critical'
                                      and w.status not in ('done', 'accepted')) as critical
            from public.work_items w where w.project_id = p.id and w.deleted_at is null
          ) st on true
          left join lateral (
            select ph.gate from public.phases ph where ph.project_id = p.id
            order by (ph.status in ('approved', 'approved_with_conditions')), ph.gate
            limit 1
          ) cur on true
          left join lateral (
            select sp.name, sp.end_date from public.sprints sp
            where sp.project_id = p.id and sp.status <> 'completed'
            order by sp.end_date limit 1
          ) ns on true
          where p.deleted_at is null
          order by p.created_at`;
        return rows.map((r): ProjectSummary => {
          const p = toProject(r);
          // No unapproved phase left means the last gate (5) is current.
          const gate = (r.current_gate ?? 1) as keyof typeof GATE_NAMES;
          return {
            ...p,
            clientName: r.client_name ?? '—',
            leadName: r.lead_name ?? '—',
            currentGate: gate,
            currentGateName: GATE_NAMES[gate] ?? 'Mobilize',
            percentComplete: r.work_count ? Math.round((r.done_count / r.work_count) * 100) : 0,
            openCritical: r.open_critical,
            itemCount: r.item_count,
            nextMilestone: r.next_sprint_name
              ? { name: `${r.next_sprint_name} ends`, date: r.next_sprint_end }
              : { name: 'Target date', date: p.targetDate },
          };
        });
      });
    },

    async getProjectBundle(s, key) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        const [client, phases, criteria, sprints, members, ppl] = await Promise.all([
          tx`select * from public.organizations where id = ${project.clientOrgId}`,
          tx`select * from public.phases where project_id = ${project.id} order by gate`,
          tx`select c.* from public.gate_criteria c join public.phases ph on ph.id = c.phase_id
             where c.project_id = ${project.id} order by ph.gate, c.position`,
          tx`select * from public.sprints where project_id = ${project.id} order by start_date`,
          tx`select * from public.project_members where project_id = ${project.id}`,
          people(tx),
        ]);
        return {
          project,
          client: client[0] ? toOrg(client[0]) : { id: project.clientOrgId, name: '—', type: 'client' },
          phases: phases.map(toPhase),
          criteria: criteria.map(toCriterion),
          sprints: sprints.map(toSprint),
          members: members.map(toMember),
          people: ppl,
        };
      });
    },

    async createProject(s, input) {
      if (!canCreateProject(s.user))
        throw new ForbiddenError('Only Admins and Delivery Leads can create projects.');
      const key = input.key.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key))
        throw new ValidationError('Key must be 2–10 letters or digits, starting with a letter.');
      return run(s, async (tx) => {
        const client = isUuid(input.clientOrgId)
          ? await tx`select 1 from public.organizations where id = ${input.clientOrgId} and type = 'client'`
          : [];
        if (!client.length) throw new ValidationError('Unknown client.');
        let id: string;
        try {
          const [row] = await tx`
            select public.create_project_from_template(
              p_key => ${key}::text,
              p_name => ${input.name.trim()}::text,
              p_client_org_id => ${input.clientOrgId}::uuid,
              p_lead_id => ${uuidOr(input.leadId)}::uuid,
              p_template_id => ${input.templateId}::text,
              p_methodology => ${input.methodology}::public.methodology,
              p_contract_type => ${input.contractType}::public.contract_type,
              p_bac => ${input.bac}::numeric,
              p_start_date => ${input.startDate || null}::date,
              p_target_date => ${input.targetDate || null}::date,
              p_restricted => ${Boolean(input.restricted)}::boolean,
              p_description => ${input.description ?? ''}::text) as id`;
          id = row.id;
        } catch (e) {
          if (e instanceof postgres.PostgresError && e.code === '23505')
            throw new ValidationError(`Key ${key} is already used.`);
          throw e;
        }
        await logActivity(tx, s, id, 'project.created', `Project ${key} created from template`, 'shared');
        return findProject(tx, id);
      });
    },

    async listItems(s, f) {
      return run(s, async (tx) => {
        if (f.projectId) f = { ...f, projectId: (await findProject(tx, f.projectId)).id };
        const rows = await tx`
          select ${ITEM_COLS(tx)} from public.work_items w
          where w.deleted_at is null ${filterSql(tx, f)}
          order by w.position, w.number`;
        return withCriteria(tx, rows);
      });
    },

    async getItem(s, key) {
      return run(s, async (tx) => {
        const item = await findItem(tx, key);
        const [comments, activity, links, children, parent] = await Promise.all([
          tx`select * from public.comments where entity_type = 'work_item' and entity_id = ${item.id}
             order by created_at`,
          tx`select * from public.activity where item_id = ${item.id} order by at desc`,
          tx`select l.id, l.from_id, l.to_id, l.type,
                    o.id as other_id, o.key as other_key, o.title as other_title, o.status as other_status
             from public.item_links l
             join public.work_items o
               on o.id = case when l.from_id = ${item.id} then l.to_id else l.from_id end
              and o.deleted_at is null
             where l.from_id = ${item.id} or l.to_id = ${item.id}`,
          tx`select ${ITEM_COLS(tx)} from public.work_items w
             where w.parent_id = ${item.id} and w.deleted_at is null order by w.position`,
          item.parentId
            ? tx`select ${ITEM_COLS(tx)} from public.work_items w
                 where w.id = ${item.parentId} and w.deleted_at is null`
            : Promise.resolve([] as Row[]),
        ]);
        return {
          item,
          comments: comments.map(toComment),
          activity: activity.map(toActivity),
          links: links.map((l) => ({
            id: l.id,
            fromId: l.from_id,
            toId: l.to_id,
            type: l.type,
            other: { id: l.other_id, key: l.other_key, title: l.other_title, status: l.other_status },
          })),
          children: await withCriteria(tx, [...children]),
          parent: parent.length ? (await withCriteria(tx, [...parent]))[0] : null,
        };
      });
    },

    async createItem(s, input) {
      const clientRequest = isClientRole(s.user.role);
      if (!canEditItems(s.user) && !(clientRequest && s.user.role !== 'client_viewer'))
        throw new ForbiddenError('You cannot create items in this project.');
      if (!input.title.trim()) throw new ValidationError('Title is required.');
      if (input.status === 'accepted') throw new ValidationError('New items cannot start as Accepted.');
      return run(s, async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (clientRequest) {
          // Clients can't insert work_items under RLS; the RPC creates a shared client_request.
          const [row] = await tx`
            select id from public.create_client_request(${project.id}::uuid, ${input.title.trim()}::text,
              ${input.description ?? ''}::text, ${input.priority ?? 'medium'}::public.priority)`;
          return findItem(tx, row.id);
        }
        const [row] = await tx`
          insert into public.work_items (project_id, type, title, description, status, priority,
            assignee_id, reporter_id, phase_id, sprint_id, parent_id, estimate, due_date, labels,
            visibility, position)
          values (${project.id}, ${input.type}, ${input.title.trim()}, ${input.description ?? ''},
            ${input.status ?? 'backlog'}, ${input.priority ?? 'medium'}, ${uuidOrNull(input.assigneeId)},
            ${s.user.id}, ${uuidOrNull(input.phaseId)}, ${uuidOrNull(input.sprintId)},
            ${uuidOrNull(input.parentId)}, ${input.estimate ?? null}, ${input.dueDate ?? null},
            ${textArray(input.labels ?? [])}::text[], ${input.visibility ?? 'internal'},
            (select coalesce(max(position), 0) + 1000 from public.work_items where project_id = ${project.id}))
          returning id, key, visibility`;
        await logActivity(tx, s, project.id, 'item.created', `${row.key} created`, row.visibility, row.id);
        return findItem(tx, row.id);
      });
    },

    async updateItem(s, id, patch) {
      return run(s, (tx) => updateOne(tx, s, id, patch));
    },

    async bulkUpdate(s, ids, patch) {
      // One transaction: either every item moves or none does.
      return run(s, async (tx) => {
        const out: WorkItem[] = [];
        for (const id of ids) out.push(await updateOne(tx, s, id, patch));
        return out;
      });
    },

    async addComment(s, { itemId, body, visibility }) {
      if (!canComment(s.user)) throw new ForbiddenError('Viewers cannot comment.');
      return run(s, async (tx) => {
        const item = await findItem(tx, itemId);
        if (!body.trim()) throw new ValidationError('Comment cannot be empty.');
        const ppl = await people(tx);
        const mentions = ppl.filter((p) => body.includes(`@${p.name.split(' ')[0]}`)).map((p) => p.id);
        const vis = isClientRole(s.user.role) ? 'shared' : visibility;
        const [row] = await tx`
          insert into public.comments (project_id, entity_type, entity_id, author_id, body, visibility, mentions)
          values (${item.projectId}, 'work_item', ${item.id}, ${s.user.id}, ${body.trim()}, ${vis},
                  ${textArray(mentions)}::uuid[])
          returning *`;
        await logActivity(
          tx,
          s,
          item.projectId,
          'comment.added',
          `Comment on ${item.key}`,
          vis === 'shared' && item.visibility === 'shared' ? 'shared' : 'internal',
          item.id,
        );
        return toComment(row);
      });
    },

    async listActivity(s, projectId, limit = 20) {
      return run(s, async (tx) => {
        const p = await findProject(tx, projectId);
        const rows = await tx`
          select * from public.activity where project_id = ${p.id} order by at desc limit ${limit}`;
        return rows.map(toActivity);
      });
    },

    async search(s, q, f = {}) {
      const term = q.trim();
      if (!term) return [];
      return run(s, async (tx) => {
        const like = `%${likeEscape(term)}%`;
        const projects = await tx`
          select id, key, name from public.projects
          where deleted_at is null and (name ilike ${like} or lower(key) = lower(${term}))
          order by name`;
        const items = await tx`
          select w.id, w.key, w.title, w.status, p.key as project_key, p.name as project_name
          from public.work_items w join public.projects p on p.id = w.project_id
          where w.deleted_at is null
            ${filterSql(tx, { ...f, q: term })}
          order by ts_rank(w.search_vector, websearch_to_tsquery('english', ${term})) desc, w.position
          limit 50`;
        const comments = await tx`
          select c.id, c.body, w.key as item_key, p.key as project_key
          from public.comments c
          join public.work_items w on w.id = c.entity_id and w.deleted_at is null
          join public.projects p on p.id = c.project_id
          where c.entity_type = 'work_item'
            and to_tsvector('english', c.body) @@ websearch_to_tsquery('english', ${term})
          order by c.created_at desc
          limit 20`;
        const out: SearchResult[] = [
          ...projects.map((p): SearchResult => ({
            kind: 'project',
            id: p.id,
            title: p.name,
            subtitle: p.key,
            href: `/projects/${p.key}`,
          })),
          ...items.map((i): SearchResult => ({
            kind: 'item',
            id: i.id,
            title: `${i.key} ${i.title}`,
            subtitle: `${STATUS_LABEL[i.status as WorkItem['status']]} · ${i.project_name}`,
            href: `/projects/${i.project_key}/board?item=${i.key}`,
          })),
          ...comments.map((c): SearchResult => ({
            kind: 'comment',
            id: c.id,
            title: String(c.body).slice(0, 80),
            subtitle: `Comment on ${c.item_key}`,
            href: `/projects/${c.project_key}/board?item=${c.item_key}`,
          })),
        ];
        return out;
      });
    },

    async deleteDemoProject(s) {
      return run(s, async (tx) => {
        const [p] = await tx`select id, lead_id from public.projects where key = ${DEMO_PROJECT_KEY}`;
        if (!p) return;
        const manager =
          s.user.role === 'admin' || (s.user.role === 'delivery_lead' && p.lead_id === s.user.id);
        if (!manager) throw new ForbiddenError('Only Admins or the project Lead can delete the demo.');
        await tx`update public.projects set deleted_at = now() where id = ${p.id}`;
        await audit(tx, s, p.id, 'project.soft_delete', 'project', p.id);
      });
    },
  };
}

/** Loads the signed-in user's profile and org, as that user (RLS applies). Null if no profile. */
export async function loadSession(sql: Sql, userId: string): Promise<Session | null> {
  if (!isUuid(userId)) return null;
  return asUser(sql, userId, async (tx) => {
    const [u] = await tx`
      select p.*, r.cost_rate from public.profiles p
      left join public.profile_rates r on r.profile_id = p.id
      where p.id = ${userId}`;
    if (!u) return null;
    const [o] = await tx`select * from public.organizations where id = ${u.org_id}`;
    if (!o) return null;
    return { user: toProfile(u), org: toOrg(o) };
  });
}

/**
 * After a successful TOTP verify (session at aal2): sets the caller's own profiles.mfa_enabled
 * through mark_mfa_enabled() (0009). `aal` is the verified JWT claim; the function refuses
 * anything but aal2.
 */
export async function markMfaEnabled(sql: Sql, userId: string, aal: string): Promise<boolean> {
  if (!isUuid(userId)) throw new NotFoundError('Profile not found');
  return asUser(
    sql,
    userId,
    async (tx) => {
      const [r] = await tx`select public.mark_mfa_enabled() as ok`;
      return Boolean(r.ok);
    },
    { claims: { aal } },
  );
}

const g = globalThis as unknown as { __khSql?: Sql };

/** The app-wide pool for DATABASE_URL (one per server process, reused across hot reloads). */
export function getSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  return (g.__khSql ??= createSql(url));
}

let repo: Repo | undefined;
export const postgresRepo = (): Repo => (repo ??= createPostgresRepo(getSql()));
