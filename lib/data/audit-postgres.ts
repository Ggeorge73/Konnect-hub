import { isIP } from 'node:net';
import type { Session } from '../domain/types';
import type { AuditPage, AuditStore } from './audit';
import { normaliseQuery, requireAuditReader } from './audit-rules';
import { asUser, getSql, isUuid, jsonParam, uuidOrNull, type Sql } from './postgres';

/**
 * Audit log on Postgres (audit_log from 0001). RLS: only Admins read; anyone appends an entry
 * attributed to themselves; nobody (not even the owner) updates, deletes or truncates.
 */
const ipOrNull = (ip?: string) => (ip && isIP(ip) ? ip : null);
/** Entries written before jsonParam existed hold a JSON string; show them as the object they encode. */
function fromJsonb(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string' && /^[[{"]/.test(v)) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

export function createPostgresAuditStore(sql: Sql): AuditStore {
  return {
    async listAudit(s, q): Promise<AuditPage> {
      requireAuditReader(s);
      const n = normaliseQuery(q);
      return asUser(sql, s.user.id, async (tx) => {
        const where = tx`
          where true
            ${n.actorId ? tx`and a.actor_id = ${uuidOrNull(n.actorId)}` : tx``}
            ${n.actionPrefix ? tx`and lower(a.action) like ${n.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'}` : tx``}
            ${n.from ? tx`and a.at >= ${n.from}` : tx``}
            ${n.to ? tx`and a.at < ${n.to}` : tx``}`;
        const rows = await tx`
          select a.*, a.ip::text as ip_text, p.name as actor_name, count(*) over () as total
            from public.audit_log a
            left join public.profiles p on p.id = a.actor_id
          ${where}
          order by a.at desc, a.id desc
          limit ${n.pageSize} offset ${(n.page - 1) * n.pageSize}`;
        let total = rows.length ? Number(rows[0].total) : 0;
        if (!rows.length && n.page > 1)
          total = Number((await tx`select count(*) as n from public.audit_log a ${where}`)[0].n);
        const actors = await tx`
          select distinct a.actor_id, coalesce(p.name, a.actor_id::text) as name
            from public.audit_log a left join public.profiles p on p.id = a.actor_id
           where a.actor_id is not null order by name`;
        return {
          rows: rows.map((r) => ({
            id: String(r.id),
            actorId: r.actor_id ?? null,
            actorName: r.actor_name ?? (r.actor_id ? String(r.actor_id) : 'System'),
            action: r.action,
            entity: r.entity,
            entityId: r.entity_id ?? '',
            before: fromJsonb(r.before),
            after: fromJsonb(r.after),
            ip: r.ip_text ? String(r.ip_text).replace(/\/(32|128)$/, '') : null,
            at: r.at,
          })),
          total,
          page: n.page,
          pageSize: n.pageSize,
          actors: actors.map((a) => ({ id: a.actor_id, name: a.name })),
        };
      });
    },

    async record(s: Session, e, ip) {
      await asUser(sql, s.user.id, async (tx) => {
        await tx`
          insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after, ip)
          values (${s.user.id}, ${uuidOrNull(e.projectId)}, ${e.action}, ${e.entity}, ${e.entityId},
                  ${jsonParam(tx, e.before)}::jsonb, ${jsonParam(tx, e.after)}::jsonb, ${ipOrNull(ip)}::inet)`;
      });
    },

    async recordLogin(userId, method, ip) {
      if (!isUuid(userId)) return;
      await asUser(sql, userId, async (tx) => {
        await tx`
          insert into public.audit_log (actor_id, action, entity, entity_id, after, ip)
          select ${userId}, 'auth.login', 'session', ${userId}, ${jsonParam(tx, { method })}::jsonb, ${ipOrNull(ip)}::inet
           where exists (select 1 from public.profiles where id = ${userId})`;
      });
    },
  };
}

let store: AuditStore | undefined;
export const postgresAuditStore = (): AuditStore => (store ??= createPostgresAuditStore(getSql()));
