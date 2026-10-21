import type { Profile, Project, Role, Session } from '../domain/types';
import {
  actionBlocker,
  isOpenItem,
  statusFor,
  type ClientItem,
  type CrmChangeEntry,
  type CrmProjectLink,
  type DecisionInput,
  type HealthSnapshot,
  type IntegrationEvent,
  type SurveyInput,
} from '../domain/crm';
import { canSeeFinancials, canSeeProject, isClientRole } from '../domain/permissions';
import { db } from './memory';
import { isPostgresEnabled } from './index';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { logActivity, writeAudit } from './gates';
import { notify, type NotifyEvent } from './notify';
import { postgresIntegrationStore } from './integration-postgres';

/**
 * Konnector CRM integration storage (docs/integration.md): the event log, the client ↔ CRM
 * account mapping, the handoff details kept per project and the commercial items published to
 * the portal. Two implementations, picked like getRepo(): the demo store below and the Postgres
 * store in integration-postgres.ts (supabase/migrations/0018_crm_integration.sql).
 *
 * "System" methods have no session: only lib/integration/service.ts calls them, after it has
 * verified the CRM's signature. Session methods apply the portal and internal access rules.
 */

/** A client user of an organization, for notifications. */
export interface OrgRecipient {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface ProjectCommercial {
  /** Handoff details: Admins and the project's Delivery Lead only (contract value). */
  link: CrmProjectLink | null;
  items: ClientItem[];
}

export type NewIntegrationEvent = Omit<IntegrationEvent, 'id' | 'createdAt' | 'updatedAt'>;
export type EventPatch = Partial<
  Pick<IntegrationEvent, 'status' | 'attempts' | 'lastError' | 'response' | 'nextAttemptAt'>
>;

export interface IntegrationStore {
  // --- Event log (system) ---
  findEvent(direction: IntegrationEvent['direction'], key: string): Promise<IntegrationEvent | null>;
  insertEvent(e: NewIntegrationEvent): Promise<IntegrationEvent>;
  updateEvent(id: string, patch: EventPatch): Promise<IntegrationEvent>;
  getEvent(id: string): Promise<IntegrationEvent | null>;
  /** Outbound events waiting for (re)delivery whose time has come. */
  dueOutbound(now: Date): Promise<IntegrationEvent[]>;
  /** Admin console: the most recent events, newest first. */
  listEvents(s: Session, limit?: number): Promise<IntegrationEvent[]>;

  // --- Directory (system) ---
  /** An active profile by email (case-insensitive). */
  findProfileByEmail(email: string): Promise<Profile | null>;
  /** The first active Admin: the default integration actor. */
  firstAdmin(): Promise<Profile | null>;
  findOrgByCrmId(crmId: string): Promise<string | null>;
  findClientOrg(idOrName: string): Promise<{ id: string; name: string } | null>;
  linkOrg(orgId: string, crmId: string): Promise<void>;
  projectKeys(): Promise<string[]>;
  findProject(id: string): Promise<Pick<Project, 'id' | 'key' | 'name' | 'leadId' | 'clientOrgId'> | null>;
  orgRecipients(orgId: string, roles: Role[]): Promise<OrgRecipient[]>;

  // --- Handoff details (system) ---
  insertProjectLink(link: Omit<CrmProjectLink, 'changes' | 'lastHealth' | 'lastHealthSentAt'>): Promise<void>;
  getProjectLink(projectId: string): Promise<CrmProjectLink | null>;
  listProjectLinks(): Promise<CrmProjectLink[]>;
  saveHealth(projectId: string, h: HealthSnapshot, at: string): Promise<void>;
  /** `project.extended`: moves the target date and/or adds to the budget, with a visible change entry. */
  extendProject(
    projectId: string,
    change: Omit<CrmChangeEntry, 'previousEndDate'>,
    actorId: string,
  ): Promise<CrmChangeEntry>;

  // --- Commercial items (system) ---
  /** Stores a published version; older open versions of the same lineage become `superseded`. */
  upsertItem(item: ClientItem): Promise<ClientItem>;
  withdrawItem(id: string, reason: string | null): Promise<ClientItem | null>;
  getItemSystem(id: string): Promise<ClientItem | null>;
  openItems(): Promise<ClientItem[]>;
  markReminded(id: string, at: string): Promise<void>;
  /** In-app (and per preference email) notification about a project. */
  notify(e: NotifyEvent): Promise<void>;

  // --- Session-scoped ---
  /** Clients: their organization's items (optionally one project). Konnector: one project, read-only. */
  listItems(s: Session, opts?: { projectKey?: string }): Promise<ClientItem[]>;
  getItem(s: Session, id: string): Promise<ClientItem>;
  /** First open by a client user. `first` is true only the first time anyone opens it. */
  recordView(s: Session, id: string, at: string): Promise<{ item: ClientItem; first: boolean }>;
  decide(s: Session, id: string, input: DecisionInput, ip: string | null, at: string): Promise<ClientItem>;
  answerSurvey(s: Session, id: string, input: SurveyInput, at: string): Promise<ClientItem>;
  getProjectCommercial(s: Session, projectKey: string): Promise<ProjectCommercial>;
}

const crm = () => db().crm;
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

/** Konnector users who may see commercial items: anyone internal but associates. */
export const canSeeCommercial = (s: Session) => !isClientRole(s.user.role) && s.user.role !== 'associate';

/** May this user see this item? Clients: own org. Konnector: the project, and never associates. */
export function canSeeItem(s: Session, item: ClientItem, project: Project | undefined): boolean {
  if (isClientRole(s.user.role)) return item.orgId === s.user.orgId;
  if (!canSeeCommercial(s)) return false;
  if (!item.projectId) return s.user.role === 'admin';
  return Boolean(project && canSeeProject(s.user, project, db().members));
}

function memItem(s: Session, id: string): ClientItem {
  const item = crm().items.find((i) => i.id === id);
  const project = item?.projectId ? db().projects.find((p) => p.id === item.projectId) : undefined;
  if (!item || !canSeeItem(s, item, project)) throw new NotFoundError('Item not found');
  return item;
}

function requireClientActor(s: Session, item: ClientItem) {
  if (!isClientRole(s.user.role))
    throw new ForbiddenError('Commercial items are owned by the CRM: Konnector users can only view them.');
  const blocker = actionBlocker(s.user.role, item);
  if (blocker) throw isOpenItem(item) ? new ForbiddenError(blocker) : new ValidationError(blocker);
}

export const memoryIntegrationStore: IntegrationStore = {
  async findEvent(direction, key) {
    const e = crm().events.find((x) => x.direction === direction && x.idempotencyKey === key);
    return e ? clone(e) : null;
  },
  async insertEvent(e) {
    const at = now();
    const row: IntegrationEvent = { ...clone(e), id: newId('ie'), createdAt: at, updatedAt: at };
    crm().events.push(row);
    return clone(row);
  },
  async updateEvent(id, patch) {
    const e = crm().events.find((x) => x.id === id);
    if (!e) throw new NotFoundError('Event not found');
    Object.assign(e, clone(patch), { updatedAt: now() });
    return clone(e);
  },
  async getEvent(id) {
    const e = crm().events.find((x) => x.id === id);
    return e ? clone(e) : null;
  },
  async dueOutbound(at) {
    return crm()
      .events.filter(
        (e) =>
          e.direction === 'outbound' &&
          (e.status === 'pending' || e.status === 'failed') &&
          (!e.nextAttemptAt || e.nextAttemptAt <= at.toISOString()),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  },
  async listEvents(s, limit = 100) {
    if (s.user.role !== 'admin') throw new ForbiddenError('Only Admins can see integration events.');
    return [...crm().events]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map(clone);
  },

  async findProfileByEmail(email) {
    const p = db().profiles.find((x) => x.email.toLowerCase() === email.toLowerCase() && !x.deactivatedAt);
    return p ? clone(p) : null;
  },
  async firstAdmin() {
    const p = db().profiles.find((x) => x.role === 'admin' && !x.deactivatedAt);
    return p ? clone(p) : null;
  },
  async findOrgByCrmId(crmId) {
    return crm().accounts.find((a) => a.crmId === crmId)?.orgId ?? null;
  },
  async findClientOrg(idOrName) {
    const o = db().orgs.find(
      (x) => x.type === 'client' && (x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase()),
    );
    return o ? { id: o.id, name: o.name } : null;
  },
  async linkOrg(orgId, crmId) {
    const a = crm().accounts;
    if (!a.some((x) => x.orgId === orgId && x.crmId === crmId)) a.push({ orgId, crmId });
  },
  async projectKeys() {
    return db().projects.map((p) => p.key);
  },
  async findProject(id) {
    const p = db().projects.find((x) => (x.id === id || x.key === id) && !x.deletedAt);
    return p ? { id: p.id, key: p.key, name: p.name, leadId: p.leadId, clientOrgId: p.clientOrgId } : null;
  },
  async orgRecipients(orgId, roles) {
    return db()
      .profiles.filter((p) => p.orgId === orgId && roles.includes(p.role) && !p.deactivatedAt)
      .map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role }));
  },

  async insertProjectLink(link) {
    crm().links.push({ ...clone(link), changes: [], lastHealth: null, lastHealthSentAt: null });
  },
  async getProjectLink(projectId) {
    const l = crm().links.find((x) => x.projectId === projectId);
    return l ? clone(l) : null;
  },
  async listProjectLinks() {
    const live = new Set(
      db()
        .projects.filter((p) => !p.deletedAt)
        .map((p) => p.id),
    );
    return crm()
      .links.filter((l) => live.has(l.projectId))
      .map(clone);
  },
  async saveHealth(projectId, h, at) {
    const l = crm().links.find((x) => x.projectId === projectId);
    if (l) Object.assign(l, { lastHealth: clone(h), lastHealthSentAt: at });
  },
  async extendProject(projectId, change, actorId) {
    const d = db();
    const p = d.projects.find((x) => x.id === projectId && !x.deletedAt);
    const l = crm().links.find((x) => x.projectId === projectId);
    if (!p || !l) throw new NotFoundError('Project not found');
    const actor = { user: d.profiles.find((u) => u.id === actorId)! } as Session;
    const before = { targetDate: p.targetDate, bac: p.bac };
    const entry: CrmChangeEntry = { ...change, previousEndDate: p.targetDate };
    if (change.newEndDate) p.targetDate = change.newEndDate;
    if (change.additionalValue) {
      p.bac += change.additionalValue;
      l.value += change.additionalValue;
    }
    l.changes.push(entry);
    logActivity(actor, p.id, 'project.extended', extensionText(entry));
    writeAudit(actor, 'crm.project_extended', 'project', p.id, before, {
      targetDate: p.targetDate,
      bac: p.bac,
      reason: change.reason,
    });
    return clone(entry);
  },

  async upsertItem(item) {
    const items = crm().items;
    const existing = items.find((i) => i.id === item.id);
    if (existing) return clone(existing);
    for (const older of items)
      if (older.lineageId === item.lineageId && older.version < item.version && isOpenItem(older))
        older.status = 'superseded';
    items.push(clone(item));
    return clone(item);
  },
  async withdrawItem(id, reason) {
    const item = crm().items.find((i) => i.id === id);
    if (!item) return null;
    if (item.status !== 'withdrawn') Object.assign(item, { status: 'withdrawn', withdrawnReason: reason });
    return clone(item);
  },
  async getItemSystem(id) {
    const item = crm().items.find((i) => i.id === id);
    return item ? clone(item) : null;
  },
  async openItems() {
    return crm().items.filter(isOpenItem).map(clone);
  },
  async markReminded(id, at) {
    const item = crm().items.find((i) => i.id === id);
    if (item) item.remindedAt = at;
  },
  async notify(e) {
    notify(e);
  },

  async listItems(s, opts = {}) {
    const d = db();
    let projectId: string | undefined;
    if (opts.projectKey) {
      const p = d.projects.find((x) => x.key === opts.projectKey || x.id === opts.projectKey);
      if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
      projectId = p.id;
    } else if (!isClientRole(s.user.role)) {
      throw new ValidationError('Pick a project.');
    }
    return crm()
      .items.filter((i) => (projectId ? i.projectId === projectId : true))
      .filter((i) => i.status !== 'superseded' || !isClientRole(s.user.role))
      .filter((i) =>
        canSeeItem(
          s,
          i,
          d.projects.find((p) => p.id === i.projectId),
        ),
      )
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map(clone);
  },
  async getItem(s, id) {
    return clone(memItem(s, id));
  },
  async recordView(s, id, at) {
    const item = memItem(s, id);
    if (!isClientRole(s.user.role) || item.firstViewedAt) return { item: clone(item), first: false };
    Object.assign(item, { firstViewedAt: at, firstViewedBy: s.user.id });
    if (item.status === 'open') item.status = 'viewed';
    return { item: clone(item), first: true };
  },
  async decide(s, id, input, ip, at) {
    const item = memItem(s, id);
    if (item.type === 'survey') throw new ValidationError('Answer the survey instead.');
    requireClientActor(s, item);
    if (input.decision === 'accepted' && item.requiresSignature)
      throw new ValidationError('This item is accepted by signing the document.');
    const before = { status: item.status };
    Object.assign(item, {
      status: statusFor(input.decision),
      decidedAt: at,
      decidedById: s.user.id,
      decidedByName: input.name || s.user.name,
      decidedByTitle: input.title || null,
      decidedByEmail: s.user.email,
      decidedIp: ip,
      decisionNote: input.note || null,
    });
    writeAudit(
      s,
      `client_item.${input.decision}`,
      'client_item',
      item.id,
      before,
      decisionAudit(item),
      ip ?? undefined,
    );
    return clone(item);
  },
  async answerSurvey(s, id, input, at) {
    const item = memItem(s, id);
    if (item.type !== 'survey') throw new ValidationError('This item is not a survey.');
    requireClientActor(s, item);
    Object.assign(item, {
      status: 'accepted',
      surveyScore: input.score,
      surveyComment: input.comment || null,
      decidedAt: at,
      decidedById: s.user.id,
      decidedByName: s.user.name,
      decidedByEmail: s.user.email,
    });
    writeAudit(s, 'client_item.survey_submitted', 'client_item', item.id, undefined, { score: input.score });
    return clone(item);
  },
  async getProjectCommercial(s, key) {
    if (!canSeeCommercial(s)) throw new ForbiddenError('Commercial items are not available to your role.');
    const d = db();
    const p = d.projects.find((x) => (x.key === key || x.id === key) && !x.deletedAt);
    if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
    const link = canSeeFinancials(s.user) ? crm().links.find((l) => l.projectId === p.id) : undefined;
    return { link: link ? clone(link) : null, items: await this.listItems(s, { projectKey: p.key }) };
  },
};

/** "End date moved from … to …; value +…": the visible change entry text. */
export function extensionText(c: CrmChangeEntry): string {
  const parts: string[] = [];
  if (c.newEndDate && c.newEndDate !== c.previousEndDate)
    parts.push(`end date moved from ${c.previousEndDate} to ${c.newEndDate}`);
  if (c.additionalValue) parts.push(`value +${c.additionalValue.toLocaleString('en-US')} ${c.currency}`);
  return `Extended by Konnector CRM: ${parts.join('; ') || 'no change'} (${c.reason})`;
}

export const decisionAudit = (i: ClientItem) => ({
  status: i.status,
  version: i.version,
  name: i.decidedByName,
  title: i.decidedByTitle,
  email: i.decidedByEmail,
  note: i.decisionNote,
});

/** The active store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const integrationStore = (): IntegrationStore =>
  isPostgresEnabled() ? postgresIntegrationStore() : memoryIntegrationStore;
