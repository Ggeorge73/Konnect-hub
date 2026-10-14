import type { Project, Session, WorkItem } from '../domain/types';
import { canManageProject, canSeeFinancials, canSeeProject, isClientRole } from '../domain/permissions';
import {
  canApproveTime,
  canLogTime,
  canSeeTimeCost,
  costCents,
  hoursError,
  isEditable,
  isIsoDate,
  rejectReasonError,
  sumHours,
  weekDays,
  type TimeEntry,
  type TimeEntryView,
} from '../domain/ledger';
import type { Cents } from '../domain/evm';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresLedgerStore } from './ledger-postgres';

/**
 * Time tracking (KH-37 TIME-01). `LedgerStore` has two implementations, picked like getRepo():
 * `memoryLedgerStore` (demo store, below) and the Postgres + RLS store in ledger-postgres.ts
 * (time_entries, 0001 + 0012_ledger.sql). Shared behaviour: lib/data/contract-ledger.ts.
 *
 * - Internal users log time on items of projects they can see (associates: assigned projects only).
 *   Clients never read or write time entries.
 * - People see their own entries; the project Lead and Admins see and decide submitted ones.
 * - Approved entries are locked. Cost rates and cost amounts are returned to Admins only.
 */
export interface LogTimeInput {
  /** Work item id or key (EHR-7). */
  itemId: string;
  date: string;
  hours: number;
  billable?: boolean;
  note?: string;
}

export interface TimePatch {
  date?: string;
  hours?: number;
  billable?: boolean;
  note?: string;
}

export interface ApprovedTimeFilter {
  projectKey?: string;
  from?: string;
  to?: string;
}

export interface ItemTimeSummary {
  itemId: string;
  itemKey: string;
  /** Everyone's logged hours on the item (any status). */
  totalHours: number;
  /** The caller's own hours on the item. */
  myHours: number;
  /** The caller's own entries on the item, newest first. */
  mine: TimeEntryView[];
}

export type TimeDecision = 'approved' | 'rejected';

export interface LedgerStore {
  logTime(s: Session, input: LogTimeInput, now?: Date): Promise<TimeEntryView>;
  updateTime(s: Session, id: string, patch: TimePatch, now?: Date): Promise<TimeEntryView>;
  deleteTime(s: Session, id: string): Promise<void>;
  /** The caller's own entries in the ISO week starting `weekStart` (a Monday). */
  listWeek(s: Session, weekStart: string): Promise<TimeEntryView[]>;
  /** Moves the caller's draft entries of the week to submitted. Returns the submitted entries. */
  submitWeek(s: Session, weekStart: string, now?: Date): Promise<TimeEntryView[]>;
  /** Submitted entries on projects the caller leads (Admins: all projects). */
  listApprovals(s: Session): Promise<TimeEntryView[]>;
  /** Approve or reject submitted entries (reason required to reject). Audited. */
  decideTime(
    s: Session,
    ids: string[],
    decision: TimeDecision,
    reason?: string,
    now?: Date,
  ): Promise<TimeEntryView[]>;
  /** Approved entries on projects the caller leads (Admins: all), for the invoicing export. */
  listApproved(s: Session, f: ApprovedTimeFilter): Promise<TimeEntryView[]>;
  /** Logged hours on an item (internal users only). */
  itemTime(s: Session, itemKey: string): Promise<ItemTimeSummary>;
  /** Σ approved hours × cost rate (cents) up to `asOf`. Admin / Delivery Lead (canSeeFinancials). */
  approvedCost(s: Session, projectKey: string, asOf: string): Promise<Cents>;
}

const iso = (d: Date) => d.toISOString();

function requireInternal(s: Session) {
  if (!canLogTime(s.user.role)) throw new ForbiddenError('Time tracking is for Konnector staff.');
}

function visibleProject(s: Session, idOrKey: string): Project {
  const d = db();
  const p = d.projects.find((x) => x.id === idOrKey || x.key === idOrKey.toUpperCase());
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

function findItem(s: Session, idOrKey: string): { item: WorkItem; project: Project } {
  const d = db();
  const item = d.items.find((i) => (i.id === idOrKey || i.key === idOrKey.toUpperCase()) && !i.deletedAt);
  if (!item) throw new NotFoundError('Item not found');
  const project = d.projects.find((p) => p.id === item.projectId);
  if (!project || !canSeeProject(s.user, project, d.members)) throw new NotFoundError('Item not found');
  return { item, project };
}

function view(s: Session, e: TimeEntry): TimeEntryView {
  const d = db();
  const item = e.itemId ? d.items.find((i) => i.id === e.itemId) : undefined;
  const name = (id: string | null) => (id ? (d.profiles.find((p) => p.id === id)?.name ?? '—') : null);
  const out: TimeEntryView = {
    ...e,
    projectKey: d.projects.find((p) => p.id === e.projectId)?.key ?? '—',
    itemKey: item?.key ?? null,
    itemTitle: item?.title ?? null,
    userName: name(e.userId) ?? '—',
    decidedByName: name(e.decidedBy),
  };
  if (canSeeTimeCost(s.user)) {
    const rate = d.profiles.find((p) => p.id === e.userId)?.costRate ?? null;
    out.costRate = rate;
    out.costCents = rate == null ? null : costCents(e.hours, rate);
  }
  return out;
}

function checkFields(p: { date?: string; hours?: number }) {
  if (p.date !== undefined && !isIsoDate(p.date)) throw new ValidationError('Enter a valid date.');
  if (p.hours !== undefined) {
    const err = hoursError(p.hours);
    if (err) throw new ValidationError(err);
  }
}

function checkWeek(weekStart: string) {
  if (!isIsoDate(weekStart) || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1)
    throw new ValidationError('A week starts on a Monday (YYYY-MM-DD).');
}

/** The caller's own entry (internal users only; other people's entries look not found). */
function ownEntry(s: Session, id: string): TimeEntry {
  requireInternal(s);
  const e = db().ledger.timeEntries.find((x) => x.id === id);
  if (!e || e.userId !== s.user.id) throw new NotFoundError('Time entry not found');
  return e;
}

function audit(s: Session, action: string, e: TimeEntry, before?: unknown, after?: unknown) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action,
    entity: 'time_entry',
    entityId: e.id,
    before,
    after,
    at: iso(new Date()),
  });
}

async function memLogTime(s: Session, input: LogTimeInput, now: Date = new Date()): Promise<TimeEntryView> {
  requireInternal(s);
  const { item, project } = findItem(s, input.itemId);
  checkFields(input);
  const t = iso(now);
  const e: TimeEntry = {
    id: newId('te'),
    projectId: project.id,
    itemId: item.id,
    userId: s.user.id,
    date: input.date,
    hours: input.hours,
    billable: input.billable ?? true,
    note: input.note?.trim() ?? '',
    status: 'draft',
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    createdAt: t,
    updatedAt: t,
  };
  db().ledger.timeEntries.push(e);
  return view(s, e);
}

async function memUpdateTime(
  s: Session,
  id: string,
  patch: TimePatch,
  now: Date = new Date(),
): Promise<TimeEntryView> {
  const e = ownEntry(s, id);
  if (e.status === 'approved') throw new ForbiddenError('Approved time is locked.');
  if (!isEditable(e)) throw new ForbiddenError('Submitted time is read-only until your Lead decides.');
  checkFields(patch);
  Object.assign(e, {
    ...(patch.date !== undefined ? { date: patch.date } : {}),
    ...(patch.hours !== undefined ? { hours: patch.hours } : {}),
    ...(patch.billable !== undefined ? { billable: patch.billable } : {}),
    ...(patch.note !== undefined ? { note: patch.note.trim() } : {}),
    status: 'draft',
    updatedAt: iso(now),
  });
  return view(s, e);
}

async function memDeleteTime(s: Session, id: string): Promise<void> {
  const e = ownEntry(s, id);
  if (e.status === 'approved') throw new ForbiddenError('Approved time is locked.');
  if (!isEditable(e)) throw new ForbiddenError('Submitted time is read-only until your Lead decides.');
  const list = db().ledger.timeEntries;
  list.splice(list.indexOf(e), 1);
}

const inWeek = (weekStart: string) => {
  const days = weekDays(weekStart);
  return (e: TimeEntry) => e.date >= days[0] && e.date <= days[6];
};

function stillVisible(s: Session, e: TimeEntry) {
  const d = db();
  const p = d.projects.find((x) => x.id === e.projectId);
  return Boolean(p && canSeeProject(s.user, p, d.members));
}

async function memListWeek(s: Session, weekStart: string): Promise<TimeEntryView[]> {
  requireInternal(s);
  checkWeek(weekStart);
  return db()
    .ledger.timeEntries.filter((e) => e.userId === s.user.id && inWeek(weekStart)(e) && stillVisible(s, e))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => view(s, e));
}

async function memSubmitWeek(
  s: Session,
  weekStart: string,
  now: Date = new Date(),
): Promise<TimeEntryView[]> {
  requireInternal(s);
  checkWeek(weekStart);
  const t = iso(now);
  const out = db().ledger.timeEntries.filter(
    (e) => e.userId === s.user.id && inWeek(weekStart)(e) && e.status === 'draft' && stillVisible(s, e),
  );
  if (!out.length) throw new ValidationError('There is no draft time to submit for this week.');
  for (const e of out) Object.assign(e, { status: 'submitted', submittedAt: t, updatedAt: t });
  return out.map((e) => view(s, e));
}

function managedProjectIds(s: Session): Set<string> {
  const d = db();
  return new Set(
    d.projects
      .filter((p) => canSeeProject(s.user, p, d.members) && canManageProject(s.user, p))
      .map((p) => p.id),
  );
}

function requireApprover(s: Session) {
  if (s.user.role !== 'admin' && s.user.role !== 'delivery_lead')
    throw new ForbiddenError('Only Delivery Leads and Admins approve time.');
}

async function memListApprovals(s: Session): Promise<TimeEntryView[]> {
  requireApprover(s);
  const managed = managedProjectIds(s);
  return db()
    .ledger.timeEntries.filter((e) => e.status === 'submitted' && managed.has(e.projectId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => view(s, e));
}

async function memDecideTime(
  s: Session,
  ids: string[],
  decision: TimeDecision,
  reason?: string,
  now: Date = new Date(),
): Promise<TimeEntryView[]> {
  requireApprover(s);
  const err = rejectReasonError(decision, reason);
  if (err) throw new ValidationError(err);
  if (!ids.length) throw new ValidationError('Choose at least one time entry.');
  const d = db();
  const entries = [...new Set(ids)].map((id) => {
    const e = d.ledger.timeEntries.find((x) => x.id === id);
    const p = e && d.projects.find((x) => x.id === e.projectId);
    if (!e || !p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Time entry not found');
    if (!canApproveTime(s.user, p))
      throw new ForbiddenError('Only the project Lead or an Admin can approve this time.');
    if (e.status !== 'submitted')
      throw new ValidationError('Only submitted time can be approved or rejected.');
    return e;
  });
  const t = iso(now);
  for (const e of entries) {
    Object.assign(e, {
      status: decision,
      decidedBy: s.user.id,
      decidedAt: t,
      rejectReason: decision === 'rejected' ? reason!.trim() : null,
      updatedAt: t,
    });
    audit(
      s,
      decision === 'approved' ? 'time.approve' : 'time.reject',
      e,
      { status: 'submitted' },
      { status: decision, hours: e.hours, ...(e.rejectReason ? { reason: e.rejectReason } : {}) },
    );
  }
  return entries.map((e) => view(s, e));
}

async function memListApproved(s: Session, f: ApprovedTimeFilter): Promise<TimeEntryView[]> {
  requireApprover(s);
  const managed = managedProjectIds(s);
  const only = f.projectKey ? visibleProject(s, f.projectKey).id : null;
  return db()
    .ledger.timeEntries.filter(
      (e) =>
        e.status === 'approved' &&
        managed.has(e.projectId) &&
        (!only || e.projectId === only) &&
        (!f.from || e.date >= f.from) &&
        (!f.to || e.date <= f.to),
    )
    .map((e) => view(s, e))
    .sort(
      (a, b) =>
        a.projectKey.localeCompare(b.projectKey) ||
        a.date.localeCompare(b.date) ||
        a.userName.localeCompare(b.userName) ||
        a.id.localeCompare(b.id),
    );
}

async function memItemTime(s: Session, itemKey: string): Promise<ItemTimeSummary> {
  requireInternal(s);
  const { item } = findItem(s, itemKey);
  const all = db().ledger.timeEntries.filter((e) => e.itemId === item.id);
  const mine = all.filter((e) => e.userId === s.user.id);
  return {
    itemId: item.id,
    itemKey: item.key,
    totalHours: sumHours(all),
    myHours: sumHours(mine),
    mine: mine
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((e) => view(s, e)),
  };
}

async function memApprovedCost(s: Session, projectKey: string, asOf: string): Promise<Cents> {
  const p = visibleProject(s, projectKey);
  if (isClientRole(s.user.role) || !canSeeFinancials(s.user))
    throw new ForbiddenError('Actual cost is visible to Admins and Delivery Leads only.');
  const d = db();
  return d.ledger.timeEntries
    .filter((e) => e.projectId === p.id && e.status === 'approved' && e.date <= asOf)
    .reduce(
      (sum, e) => sum + costCents(e.hours, d.profiles.find((u) => u.id === e.userId)?.costRate ?? 0),
      0,
    );
}

/** The demo-store implementation. */
export const memoryLedgerStore: LedgerStore = {
  logTime: memLogTime,
  updateTime: memUpdateTime,
  deleteTime: memDeleteTime,
  listWeek: memListWeek,
  submitWeek: memSubmitWeek,
  listApprovals: memListApprovals,
  decideTime: memDecideTime,
  listApproved: memListApproved,
  itemTime: memItemTime,
  approvedCost: memApprovedCost,
};

/** The active ledger store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const ledgerStore = (): LedgerStore =>
  isPostgresEnabled() ? postgresLedgerStore() : memoryLedgerStore;

// Public API used by route handlers and pages: each call goes to the active store.
export const logTime: LedgerStore['logTime'] = (...a) => ledgerStore().logTime(...a);
export const updateTime: LedgerStore['updateTime'] = (...a) => ledgerStore().updateTime(...a);
export const deleteTime: LedgerStore['deleteTime'] = (...a) => ledgerStore().deleteTime(...a);
export const listWeek: LedgerStore['listWeek'] = (...a) => ledgerStore().listWeek(...a);
export const submitWeek: LedgerStore['submitWeek'] = (...a) => ledgerStore().submitWeek(...a);
export const listApprovals: LedgerStore['listApprovals'] = (...a) => ledgerStore().listApprovals(...a);
export const decideTime: LedgerStore['decideTime'] = (...a) => ledgerStore().decideTime(...a);
export const listApproved: LedgerStore['listApproved'] = (...a) => ledgerStore().listApproved(...a);
export const itemTime: LedgerStore['itemTime'] = (...a) => ledgerStore().itemTime(...a);
export const approvedCost: LedgerStore['approvedCost'] = (...a) => ledgerStore().approvedCost(...a);
