import type { Session } from '../domain/types';
import { isIsoDate } from '../domain/ledger';
import { ForbiddenError, ValidationError } from './errors';
import type { AuditQuery } from './audit';

/** Audit viewer rules shared by the demo and Postgres audit stores. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 5000;

export function requireAuditReader(s: Session) {
  if (s.user.role !== 'admin') throw new ForbiddenError('Only Admins can read the audit log.');
}

/** Validates and normalises a query (shared by both stores). */
export function normaliseQuery(q: AuditQuery) {
  for (const d of [q.from, q.to])
    if (d !== undefined && !isIsoDate(d)) throw new ValidationError('Dates must be YYYY-MM-DD.');
  if (q.from && q.to && q.from > q.to) throw new ValidationError('The start date is after the end date.');
  const pageSize = Math.min(Math.max(Math.trunc(q.pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(q.page ?? 1), 1);
  return {
    actorId: q.actorId || undefined,
    actionPrefix: q.actionPrefix?.trim().toLowerCase() || undefined,
    from: q.from ? `${q.from}T00:00:00.000Z` : undefined,
    // Exclusive upper bound: the start of the day after `to`.
    to: q.to ? new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000).toISOString() : undefined,
    page,
    pageSize,
  };
}
