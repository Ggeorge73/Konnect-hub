import type { Session } from '../domain/types';
import { db } from './memory';
import { newId } from './ids';
import { normaliseQuery, requireAuditReader } from './audit-rules';
import { isPostgresEnabled } from './index';
import { postgresAuditStore } from './audit-postgres';

/**
 * Audit log viewer and audit writes that are not tied to one domain (KH-38 AUD-01): exports,
 * logins. The log is append-only: there is deliberately no update or delete here, and audit_log
 * in Postgres rejects both even for its owner (0001). Only Admins read it.
 * `memoryAuditStore` reads db().audit; the Postgres store (audit-postgres.ts) reads audit_log.
 */
export interface AuditQuery {
  actorId?: string;
  /** e.g. "export." or "gate". Case-insensitive prefix of the action. */
  actionPrefix?: string;
  /** Inclusive dates (YYYY-MM-DD, UTC). */
  from?: string;
  to?: string;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip: string | null;
  at: string;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  actors: { id: string; name: string }[];
}

export interface AuditRecord {
  action: string;
  entity: string;
  entityId: string;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
}

export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './audit-rules';

export interface AuditStore {
  /** Admin only. Newest first. */
  listAudit(s: Session, q: AuditQuery): Promise<AuditPage>;
  /** Appends an entry attributed to the caller. */
  record(s: Session, e: AuditRecord, ip?: string): Promise<void>;
  /** `auth.login` for a user who just signed in (or switched demo persona). */
  recordLogin(userId: string, method: string, ip?: string): Promise<void>;
}

async function memListAudit(s: Session, q: AuditQuery): Promise<AuditPage> {
  requireAuditReader(s);
  const n = normaliseQuery(q);
  const d = db();
  const name = (id: string | null) => d.profiles.find((p) => p.id === id)?.name ?? (id ? id : 'System');
  const all = d.audit
    .map((a, i) => ({ a, i }))
    .filter(
      ({ a }) =>
        (!n.actorId || a.actorId === n.actorId) &&
        (!n.actionPrefix || a.action.toLowerCase().startsWith(n.actionPrefix)) &&
        (!n.from || a.at >= n.from) &&
        (!n.to || a.at < n.to),
    )
    .sort((x, y) => y.a.at.localeCompare(x.a.at) || y.i - x.i)
    .map(({ a }) => a);
  const actors = new Map(d.audit.map((a) => [a.actorId, name(a.actorId)]));
  return {
    rows: all.slice((n.page - 1) * n.pageSize, n.page * n.pageSize).map((a) => ({
      id: a.id,
      actorId: a.actorId ?? null,
      actorName: name(a.actorId),
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      before: a.before,
      after: a.after,
      ip: a.ip ?? null,
      at: a.at,
    })),
    total: all.length,
    page: n.page,
    pageSize: n.pageSize,
    actors: [...actors.entries()]
      .filter(([id]) => Boolean(id))
      .map(([id, nm]) => ({ id, name: nm }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function memRecord(s: Session, e: AuditRecord, ip?: string) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before: e.before,
    after: e.after,
    ip,
    at: new Date().toISOString(),
  });
}

async function memRecordLogin(userId: string, method: string, ip?: string) {
  if (!db().profiles.some((p) => p.id === userId)) return;
  db().audit.push({
    id: newId('au'),
    actorId: userId,
    action: 'auth.login',
    entity: 'session',
    entityId: userId,
    after: { method },
    ip,
    at: new Date().toISOString(),
  });
}

export const memoryAuditStore: AuditStore = {
  listAudit: memListAudit,
  record: memRecord,
  recordLogin: memRecordLogin,
};

/** The active audit store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const auditStore = (): AuditStore => (isPostgresEnabled() ? postgresAuditStore() : memoryAuditStore);

export const listAudit: AuditStore['listAudit'] = (...a) => auditStore().listAudit(...a);
export const recordAudit: AuditStore['record'] = (...a) => auditStore().record(...a);
export const recordLogin: AuditStore['recordLogin'] = (...a) => auditStore().recordLogin(...a);
