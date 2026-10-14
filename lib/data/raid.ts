import type { Project, Session } from '../domain/types';
import { canSeeProject, canSeeVisibility, isClientRole, isInternalRole } from '../domain/permissions';
import {
  computeSlaDue,
  deriveRaid,
  dueForEscalation,
  newlyEscalated,
  type RaidEntry,
  type RaidView,
} from '../domain/raid';
import { escalationRecipients, type Notification } from '../domain/notifications';
import type { CreateRaidInput, RaidPatch } from '../raid-schemas';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { checkShape } from './raid-rules';
import { isPostgresEnabled } from './index';
import { postgresRaidStore } from './raid-postgres';
import { memorySignalStore, notify } from './notify';

/**
 * RAID register and notifications. `RaidStore` has two implementations, picked like getRepo():
 * `memoryRaidStore` (demo store, below) and the Postgres + RLS store in raid-postgres.ts.
 * Both mirror the `raid_entries` / `raid_links` RLS: clients read shared entries of their own
 * org's projects; only internal users write. Shared behaviour: lib/data/contract-raid.ts.
 */
export interface RaidStore {
  listRaid(s: Session, f: { projectId?: string; itemId?: string }, now?: Date): Promise<RaidView[]>;
  getRaid(s: Session, id: string, now?: Date): Promise<RaidView>;
  createRaid(s: Session, input: CreateRaidInput, now?: Date): Promise<RaidView>;
  updateRaid(s: Session, id: string, patch: RaidPatch, now?: Date): Promise<RaidView>;
  /** RAID-02. `s` null = the system-wide cron run. */
  escalateStaleIssues(
    s: Session | null,
    now?: Date,
  ): Promise<{ escalated: string[]; notifications: Notification[] }>;
  listNotifications(s: Session): Promise<Notification[]>;
  markNotificationsRead(s: Session, ids?: string[], now?: Date): Promise<Notification[]>;
}

const iso = (d: Date) => d.toISOString();

function visibleProject(s: Session, idOrKey: string): Project {
  const d = db();
  const p = d.projects.find((x) => x.id === idOrKey || x.key === idOrKey);
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

/** Internal users (incl. associates on their assigned projects) write; clients are read-only. */
export const canEditRaid = (s: Session) => isInternalRole(s.user.role);

function view(s: Session, e: RaidEntry, now: Date): RaidView {
  const d = db();
  const linkedItemIds = isClientRole(s.user.role)
    ? e.linkedItemIds.filter((id) => {
        const it = d.items.find((i) => i.id === id);
        return it && !it.deletedAt && canSeeVisibility(s.user, it.visibility);
      })
    : e.linkedItemIds;
  return deriveRaid({ ...e, linkedItemIds }, now);
}

function findVisible(s: Session, id: string): RaidEntry {
  const e = db().raid.find((r) => r.id === id);
  if (!e || !canSeeVisibility(s.user, e.visibility)) throw new NotFoundError('RAID entry not found');
  visibleProject(s, e.projectId);
  return e;
}

function audit(s: Session, action: string, entityId: string, before?: unknown, after?: unknown) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action,
    entity: 'raid',
    entityId,
    before,
    after,
    at: iso(new Date()),
  });
}

function checkLinks(s: Session, projectId: string, ids: string[] | undefined) {
  if (!ids) return;
  const d = db();
  for (const id of ids) {
    const it = d.items.find((i) => i.id === id || i.key === id);
    if (!it || it.deletedAt || it.projectId !== projectId || !canSeeVisibility(s.user, it.visibility))
      throw new ValidationError(`Linked work item ${id} is not in this project.`);
  }
}

const toIds = (ids: string[] | undefined) =>
  ids && [...new Set(ids.map((id) => db().items.find((i) => i.id === id || i.key === id)!.id))];

function checkPeople(input: { ownerId?: string | null; decidedBy?: string | null }) {
  const d = db();
  for (const id of [input.ownerId, input.decidedBy])
    if (id && !d.profiles.some((p) => p.id === id)) throw new ValidationError('Unknown person.');
}

function riskEscalatedNotice(p: Project, e: RaidEntry, now: Date) {
  notify({
    kind: 'risk_escalated',
    projectId: p.id,
    recipients: [p.leadId],
    title: `Escalate to steering: ${e.title} (score ${(e.probability ?? 0) * (e.impact ?? 0)})`,
    href: `/projects/${p.key}/raid?tab=risk`,
    visibility: 'internal',
    now,
  });
}

async function memListRaid(
  s: Session,
  f: { projectId?: string; itemId?: string },
  now: Date = new Date(),
): Promise<RaidView[]> {
  const d = db();
  let projectIds: Set<string>;
  let itemId: string | undefined;
  if (f.itemId) {
    const it = d.items.find((i) => i.id === f.itemId || i.key === f.itemId);
    if (!it || it.deletedAt || !canSeeVisibility(s.user, it.visibility))
      throw new NotFoundError('Item not found');
    projectIds = new Set([visibleProject(s, it.projectId).id]);
    itemId = it.id;
  } else if (f.projectId) {
    projectIds = new Set([visibleProject(s, f.projectId).id]);
  } else {
    projectIds = new Set(d.projects.filter((p) => canSeeProject(s.user, p, d.members)).map((p) => p.id));
  }
  return d.raid
    .filter(
      (e) =>
        projectIds.has(e.projectId) &&
        canSeeVisibility(s.user, e.visibility) &&
        (!itemId || e.linkedItemIds.includes(itemId)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => view(s, e, now));
}

async function memGetRaid(s: Session, id: string, now: Date = new Date()): Promise<RaidView> {
  return view(s, findVisible(s, id), now);
}

async function memCreateRaid(s: Session, input: CreateRaidInput, now: Date = new Date()): Promise<RaidView> {
  const p = visibleProject(s, input.projectId);
  if (!canEditRaid(s)) throw new ForbiddenError('Client users cannot change the RAID log.');
  checkLinks(s, p.id, input.linkedItemIds);
  checkPeople(input);
  const t = iso(now);
  const status = input.status ?? 'open';
  const e: RaidEntry = {
    id: newId('rd'),
    projectId: p.id,
    kind: input.kind,
    title: input.title.trim(),
    description: input.description ?? '',
    ownerId: input.ownerId ?? null,
    status,
    visibility: input.visibility ?? 'internal',
    category: input.category ?? null,
    probability: input.probability ?? null,
    impact: input.impact ?? null,
    residualProbability: input.residualProbability ?? null,
    residualImpact: input.residualImpact ?? null,
    mitigation: input.mitigation ?? null,
    roam: input.roam ?? null,
    closureNote: input.closureNote ?? null,
    closedAt: status === 'closed' ? t : null,
    severity: input.severity ?? null,
    slaDue: input.kind === 'issue' && input.severity ? iso(computeSlaDue(input.severity, now)) : null,
    date: input.date ?? null,
    decidedBy: input.decidedBy ?? null,
    rationale: input.rationale ?? null,
    linkedItemIds: toIds(input.linkedItemIds) ?? [],
    escalatedAt: null,
    createdBy: s.user.id,
    createdAt: t,
    updatedAt: t,
  };
  if (e.kind !== 'risk') {
    e.probability = e.impact = e.residualProbability = e.residualImpact = null;
    e.category = e.roam = null;
  }
  checkShape(e);
  db().raid.push(e);
  if (e.visibility === 'shared') audit(s, 'visibility.change', e.id, 'internal', 'shared');
  if (e.status === 'closed') audit(s, 'raid.close', e.id, undefined, { closureNote: e.closureNote });
  if (e.kind === 'risk' && newlyEscalated(null, e)) riskEscalatedNotice(p, e, now);
  return view(s, e, now);
}

async function memUpdateRaid(
  s: Session,
  id: string,
  patch: RaidPatch,
  now: Date = new Date(),
): Promise<RaidView> {
  const e = findVisible(s, id);
  if (!canEditRaid(s)) throw new ForbiddenError('Client users cannot change the RAID log.');
  const p = visibleProject(s, e.projectId);
  checkLinks(s, p.id, patch.linkedItemIds);
  checkPeople(patch);
  const before = { ...e };
  const next: RaidEntry = { ...e, ...patch, linkedItemIds: toIds(patch.linkedItemIds) ?? e.linkedItemIds };
  if (patch.title !== undefined) next.title = patch.title.trim();
  if (e.kind === 'issue' && patch.severity && patch.severity !== e.severity)
    next.slaDue = iso(computeSlaDue(patch.severity, new Date(e.createdAt)));
  if (next.status === 'closed' && before.status !== 'closed') next.closedAt = iso(now);
  if (next.status !== 'closed') next.closedAt = null;
  next.updatedAt = iso(now);
  checkShape(next);
  Object.assign(e, next);
  if (before.visibility !== e.visibility)
    audit(s, 'visibility.change', e.id, before.visibility, e.visibility);
  if (before.status !== 'closed' && e.status === 'closed')
    audit(s, 'raid.close', e.id, before.status, { status: 'closed', closureNote: e.closureNote });
  if (before.status === 'closed' && e.status !== 'closed') audit(s, 'raid.reopen', e.id, 'closed', e.status);
  if (e.kind === 'risk' && e.status !== 'closed' && newlyEscalated(before, e)) riskEscalatedNotice(p, e, now);
  return view(s, e, now);
}

/**
 * RAID-02: notify the project Lead and every Admin about each stale issue (open, no update for
 * more than 10 days) that has not been escalated in the last 24 hours. With a session, only
 * that user's visible projects are scanned; the production cron runs it system-wide (session null).
 */
async function memEscalateStaleIssues(
  s: Session | null,
  now: Date = new Date(),
): Promise<{ escalated: string[]; notifications: Notification[] }> {
  const d = db();
  if (s && s.user.role !== 'admin' && s.user.role !== 'delivery_lead')
    throw new ForbiddenError('Only Admins and Delivery Leads can run escalation.');
  const projects = d.projects.filter((p) => !p.deletedAt && (!s || canSeeProject(s.user, p, d.members)));
  const admins = d.profiles.filter((u) => u.role === 'admin').map((u) => u.id);
  const escalated: string[] = [];
  const notifications: Notification[] = [];
  for (const p of projects) {
    for (const e of d.raid.filter((r) => r.projectId === p.id && dueForEscalation(r, now))) {
      const days = Math.floor((now.getTime() - new Date(e.updatedAt).getTime()) / 86_400_000);
      notifications.push(
        ...notify({
          kind: 'sla_breach',
          projectId: p.id,
          recipients: escalationRecipients(p.leadId, admins),
          title: `Stale issue on ${p.key}: ${e.title} (no update in ${days} days)`,
          href: `/projects/${p.key}/raid?tab=issue`,
          visibility: 'internal',
          now,
        }),
      );
      e.escalatedAt = iso(now);
      escalated.push(e.id);
    }
  }
  return { escalated, notifications };
}

/** The demo-store implementation. */
export const memoryRaidStore: RaidStore = {
  listRaid: memListRaid,
  getRaid: memGetRaid,
  createRaid: memCreateRaid,
  updateRaid: memUpdateRaid,
  escalateStaleIssues: memEscalateStaleIssues,
  // The notification center lives in lib/data/notify.ts (Team Signal); the demo store delegates to it.
  listNotifications: (s) => memorySignalStore.listNotifications(s),
  markNotificationsRead: (s, ids, now) => memorySignalStore.markNotificationsRead(s, ids, now),
};

/** The active RAID store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const raidStore = (): RaidStore => (isPostgresEnabled() ? postgresRaidStore() : memoryRaidStore);

// Public API used by route handlers and pages: each call goes to the active store.
export const listRaid: RaidStore['listRaid'] = (...a) => raidStore().listRaid(...a);
export const getRaid: RaidStore['getRaid'] = (...a) => raidStore().getRaid(...a);
export const createRaid: RaidStore['createRaid'] = (...a) => raidStore().createRaid(...a);
export const updateRaid: RaidStore['updateRaid'] = (...a) => raidStore().updateRaid(...a);
export const escalateStaleIssues: RaidStore['escalateStaleIssues'] = (...a) =>
  raidStore().escalateStaleIssues(...a);
export const listNotifications: RaidStore['listNotifications'] = (...a) =>
  raidStore().listNotifications(...a);
export const markNotificationsRead: RaidStore['markNotificationsRead'] = (...a) =>
  raidStore().markNotificationsRead(...a);
