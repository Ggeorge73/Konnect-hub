import type { Project, Session } from '../domain/types';
import { isInternalRole } from '../domain/permissions';
import { deriveRaid, dueForEscalation, newlyEscalated, type RaidEntry, type RaidView } from '../domain/raid';
import { escalationRecipients, type Notification } from '../domain/notifications';
import type { CreateRaidInput, RaidPatch } from '../raid-schemas';
import type { RaidStore } from './raid';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { checkShape } from './raid-rules';
import {
  asService,
  asUser,
  audit,
  findItem,
  findProject,
  getSql,
  isUuid,
  textArray,
  uuidOr,
  uuidOrNull,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { createPostgresSignalStore, pgNotify } from './notify-postgres';

/**
 * RAID register on Postgres + RLS (raid_entries, raid_links from 0003). Every call is one
 * transaction as the signed-in user (asUser), so RLS decides what each role sees and writes;
 * the database also enforces the closure rule, the escalate flag (score >= 15) and the issue
 * SLA (`sla_due_at`, filled by trigger). App-level checks only add the demo store's messages.
 */

const iso = (d: Date) => d.toISOString();

export const toEntry = (r: Row): RaidEntry => {
  const risk = r.kind === 'risk';
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    ownerId: r.owner_id ?? null,
    status: r.status,
    visibility: r.visibility,
    // Probability and impact are NOT NULL in the table (default 1); they only mean something on risks.
    category: risk && r.category ? String(r.category).toLowerCase() : null,
    probability: risk ? r.probability : null,
    impact: risk ? r.impact : null,
    residualProbability: risk ? (r.residual_probability ?? null) : null,
    residualImpact: risk ? (r.residual_impact ?? null) : null,
    mitigation: r.mitigation ?? null,
    roam: risk ? (r.roam ?? null) : null,
    closureNote: r.closure_note ?? null,
    closedAt: r.closed_at ?? null,
    severity: r.severity ?? null,
    slaDue: r.sla_due_at ?? null,
    date: r.entry_date ?? null,
    decidedBy: r.decided_by ?? null,
    rationale: r.rationale ?? null,
    // raid_links rows are RLS-filtered: a link to an item the caller can't see is not returned.
    linkedItemIds: r.linked ?? [],
    escalatedAt: r.escalated_at ?? null,
    createdBy: r.created_by ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as RaidEntry;
};

export const RAID_SELECT = (tx: Tx) => tx`
  select r.*,
    coalesce((select array_agg(l.item_id::text order by l.created_at, l.item_id)
              from public.raid_links l where l.raid_id = r.id), '{}') as linked
  from public.raid_entries r`;

async function findEntry(tx: Tx, id: string): Promise<RaidEntry> {
  const [row] = await tx`${RAID_SELECT(tx)} where r.id = ${uuidOr(id)}`;
  if (!row) throw new NotFoundError('RAID entry not found');
  return toEntry(row);
}

const requireWriter = (s: Session) => {
  if (!isInternalRole(s.user.role)) throw new ForbiddenError('Client users cannot change the RAID log.');
};

/** Resolves ids or keys to item ids in this project (visible to the caller); undefined = unchanged. */
async function resolveLinks(tx: Tx, projectId: string, ids: string[] | undefined) {
  if (!ids) return undefined;
  const out: string[] = [];
  for (const id of ids) {
    const [row] = await tx`
      select w.id from public.work_items w
      where w.deleted_at is null and w.project_id = ${projectId}
        and (w.id = ${uuidOr(id)} or w.key = ${id.toUpperCase()})`;
    if (!row) throw new ValidationError(`Linked work item ${id} is not in this project.`);
    out.push(row.id);
  }
  return [...new Set(out)];
}

async function checkPeople(tx: Tx, input: { ownerId?: string | null; decidedBy?: string | null }) {
  for (const id of [input.ownerId, input.decidedBy]) {
    if (!id) continue;
    const found = isUuid(id) ? await tx`select 1 from public.profiles where id = ${id}` : [];
    if (!found.length) throw new ValidationError('Unknown person.');
  }
}

async function saveLinks(tx: Tx, projectId: string, raidId: string, ids: string[]) {
  await tx`delete from public.raid_links
           where raid_id = ${raidId} and not (item_id = any(${textArray(ids)}::uuid[]))`;
  if (ids.length)
    await tx`insert into public.raid_links (project_id, raid_id, item_id)
             select ${projectId}, ${raidId}, unnest(${textArray(ids)}::uuid[])
             on conflict do nothing`;
}

// Notifications go through the shared Postgres sink (notify-postgres.ts): same dispatch rule as
// the demo store's notify(), written in this transaction.
const riskEscalatedNotice = (tx: Tx, p: Project, e: Pick<RaidEntry, 'title' | 'probability' | 'impact'>) =>
  pgNotify(tx, {
    kind: 'risk_escalated',
    projectId: p.id,
    recipients: [p.leadId],
    title: `Escalate to steering: ${e.title} (score ${(e.probability ?? 0) * (e.impact ?? 0)})`,
    href: `/projects/${p.key}/raid?tab=risk`,
    visibility: 'internal',
  });

/** Column for each patchable field. Probability/impact are NOT NULL: non-risks store 1. */
const COLUMNS: Record<keyof RaidPatch, string> = {
  title: 'title',
  description: 'description',
  ownerId: 'owner_id',
  status: 'status',
  visibility: 'visibility',
  category: 'category',
  probability: 'probability',
  impact: 'impact',
  residualProbability: 'residual_probability',
  residualImpact: 'residual_impact',
  mitigation: 'mitigation',
  roam: 'roam',
  closureNote: 'closure_note',
  severity: 'severity',
  date: 'entry_date',
  decidedBy: 'decided_by',
  rationale: 'rationale',
  linkedItemIds: '',
};

function columnValue(col: string, v: unknown) {
  if (col === 'owner_id' || col === 'decided_by') return uuidOrNull(v as string | null);
  if ((col === 'probability' || col === 'impact') && v == null) return 1;
  return v ?? null;
}

export function createPostgresRaidStore(sql: Sql): RaidStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  const signal = createPostgresSignalStore(sql);

  return {
    async listRaid(s, f, now = new Date()) {
      return run(s, async (tx) => {
        let where = tx`true`;
        if (f.itemId) {
          const item = await findItem(tx, f.itemId);
          where = tx`r.project_id = ${item.projectId}
            and exists (select 1 from public.raid_links l where l.raid_id = r.id and l.item_id = ${item.id})`;
        } else if (f.projectId) {
          where = tx`r.project_id = ${(await findProject(tx, f.projectId)).id}`;
        }
        const rows = await tx`${RAID_SELECT(tx)} where ${where} order by r.created_at desc, r.id`;
        return rows.map((r) => deriveRaid(toEntry(r), now));
      });
    },

    async getRaid(s, id, now = new Date()) {
      return run(s, async (tx) => deriveRaid(await findEntry(tx, id), now));
    },

    async createRaid(s, input: CreateRaidInput, now = new Date()): Promise<RaidView> {
      return run(s, async (tx) => {
        const p = await findProject(tx, input.projectId);
        requireWriter(s);
        const links = (await resolveLinks(tx, p.id, input.linkedItemIds)) ?? [];
        await checkPeople(tx, input);
        const risk = input.kind === 'risk';
        const e = {
          kind: input.kind,
          status: input.status ?? 'open',
          visibility: input.visibility ?? 'internal',
          category: risk ? (input.category ?? null) : null,
          probability: risk ? (input.probability ?? null) : null,
          impact: risk ? (input.impact ?? null) : null,
          residualProbability: risk ? (input.residualProbability ?? null) : null,
          residualImpact: risk ? (input.residualImpact ?? null) : null,
          roam: risk ? (input.roam ?? null) : null,
          severity: input.severity ?? null,
          closureNote: input.closureNote ?? null,
        };
        checkShape(e);
        const [row] = await tx`
          insert into public.raid_entries ${tx({
            project_id: p.id,
            kind: e.kind,
            title: input.title.trim(),
            description: input.description ?? '',
            owner_id: uuidOrNull(input.ownerId),
            status: e.status,
            visibility: e.visibility,
            category: e.category,
            probability: e.probability ?? 1,
            impact: e.impact ?? 1,
            residual_probability: e.residualProbability,
            residual_impact: e.residualImpact,
            mitigation: input.mitigation ?? null,
            roam: e.roam,
            closure_note: e.closureNote,
            severity: e.severity,
            entry_date: input.date ?? null,
            decided_by: uuidOrNull(input.decidedBy),
            rationale: input.rationale ?? null,
            created_by: s.user.id,
          })}
          returning id`;
        await saveLinks(tx, p.id, row.id, links);
        if (e.visibility === 'shared')
          await audit(tx, s, p.id, 'visibility.change', 'raid', row.id, 'internal', 'shared');
        if (e.status === 'closed')
          await audit(tx, s, p.id, 'raid.close', 'raid', row.id, undefined, { closureNote: e.closureNote });
        if (risk && newlyEscalated(null, e))
          await riskEscalatedNotice(tx, p, { ...e, title: input.title.trim() });
        return deriveRaid(await findEntry(tx, row.id), now);
      });
    },

    async updateRaid(s, id, patch: RaidPatch, now = new Date()): Promise<RaidView> {
      return run(s, async (tx) => {
        const before = await findEntry(tx, id);
        requireWriter(s);
        const p = await findProject(tx, before.projectId);
        const links = await resolveLinks(tx, p.id, patch.linkedItemIds);
        await checkPeople(tx, patch);
        const next: RaidEntry = { ...before, ...patch, linkedItemIds: links ?? before.linkedItemIds };
        if (patch.title !== undefined) next.title = patch.title.trim();
        checkShape(next);

        const set: Row = {};
        for (const [k, v] of Object.entries(patch)) {
          const col = COLUMNS[k as keyof RaidPatch];
          if (col && v !== undefined) set[col] = columnValue(col, k === 'title' ? next.title : v);
        }
        // The trigger stamps closed_at on closing; reopening clears it.
        if (before.status === 'closed' && next.status !== 'closed') set.closed_at = null;
        if (Object.keys(set).length)
          await tx`update public.raid_entries set ${tx(set)} where id = ${before.id}`;
        if (links) await saveLinks(tx, p.id, before.id, links);

        if (before.visibility !== next.visibility)
          await audit(
            tx,
            s,
            p.id,
            'visibility.change',
            'raid',
            before.id,
            before.visibility,
            next.visibility,
          );
        if (before.status !== 'closed' && next.status === 'closed')
          await audit(tx, s, p.id, 'raid.close', 'raid', before.id, before.status, {
            status: 'closed',
            closureNote: next.closureNote,
          });
        if (before.status === 'closed' && next.status !== 'closed')
          await audit(tx, s, p.id, 'raid.reopen', 'raid', before.id, 'closed', next.status);
        if (next.kind === 'risk' && next.status !== 'closed' && newlyEscalated(before, next))
          await riskEscalatedNotice(tx, p, next);
        return deriveRaid(await findEntry(tx, before.id), now);
      });
    },

    async escalateStaleIssues(s, now = new Date()) {
      if (s && s.user.role !== 'admin' && s.user.role !== 'delivery_lead')
        throw new ForbiddenError('Only Admins and Delivery Leads can run escalation.');
      const body = async (tx: Tx) => {
        // RLS (or service_role for the cron) limits this to the projects the caller may see.
        const projects = await tx`select id, key, lead_id from public.projects where deleted_at is null`;
        const byId = new Map(projects.map((p) => [p.id as string, p]));
        const admins = (await tx`select id from public.profiles where role = 'admin'`).map((r) => r.id);
        const open = await tx`
          select id, project_id, kind, status, title, updated_at, escalated_at
          from public.raid_entries
          where kind = 'issue' and status <> 'closed'
            and project_id = any(${textArray([...byId.keys()])}::uuid[])
          order by created_at`;
        const escalated: string[] = [];
        const notifications: Notification[] = [];
        for (const r of open) {
          const e = { kind: r.kind, status: r.status, updatedAt: r.updated_at, escalatedAt: r.escalated_at };
          if (!dueForEscalation(e, now)) continue;
          const p = byId.get(r.project_id)!;
          const days = Math.floor((now.getTime() - new Date(r.updated_at).getTime()) / 86_400_000);
          notifications.push(
            ...(await pgNotify(tx, {
              kind: 'sla_breach',
              projectId: p.id,
              recipients: escalationRecipients(p.lead_id, admins),
              title: `Stale issue on ${p.key}: ${r.title} (no update in ${days} days)`,
              href: `/projects/${p.key}/raid?tab=issue`,
              visibility: 'internal',
              now,
            })),
          );
          // escalated_at is bookkeeping: the trigger leaves updated_at (staleness) alone.
          await tx`update public.raid_entries set escalated_at = ${iso(now)} where id = ${r.id}`;
          escalated.push(r.id);
        }
        return { escalated, notifications };
      };
      return s ? run(s, body) : asService(sql, body);
    },

    listNotifications: (s) => signal.listNotifications(s),
    markNotificationsRead: (s, ids, now) => signal.markNotificationsRead(s, ids, now),
  };
}

let store: RaidStore | undefined;
export const postgresRaidStore = (): RaidStore => (store ??= createPostgresRaidStore(getSql()));
