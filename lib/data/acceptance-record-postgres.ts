import type { Session } from '../domain/types';
import { isClientRole } from '../domain/permissions';
import { DECISION_LABEL, type GateDecision } from '../domain/gates';
import type { AcceptanceRecord, AcceptanceRecordStore, AcceptanceRow } from './acceptance-record';
import { ForbiddenError } from './errors';
import { asUser, audit, findProject, getSql, opt, type Sql } from './postgres';

/**
 * The Acceptance Record (PDF-01) on Postgres + RLS. Same content rules as the demo store: only
 * decided gates and decisions on shared deliverables, never override notes or budgets.
 */
export function createPostgresAcceptanceRecordStore(sql: Sql): AcceptanceRecordStore {
  return {
    async buildAcceptanceRecord(s: Session, key: string): Promise<AcceptanceRecord> {
      return asUser(sql, s.user.id, async (tx) => {
        const project = await findProject(tx, key);
        if (isClientRole(s.user.role) && s.user.role !== 'client_sponsor')
          throw new ForbiddenError('Only the Client Sponsor can download the Acceptance Record.');
        const [gates, criteria, [client]] = await Promise.all([
          tx`select g.decision, g.conditions, g.reason, g.decided_at, host(g.ip) as ip_text,
                    ph.gate, ph.name as phase_name, pr.name as by_name
             from public.gate_reviews g
             join public.phases ph on ph.id = g.phase_id
             left join public.profiles pr on pr.id = g.decided_by
             where g.project_id = ${project.id} and g.status = 'decided' and g.decision is not null`,
          tx`select c.text, c.status, c.note, c.decided_at, host(c.ip) as ip_text,
                    d.name as deliverable_name, pr.name as by_name
             from public.deliverable_criteria c
             join public.deliverables d on d.id = c.deliverable_id
             left join public.profiles pr on pr.id = c.decided_by
             where d.project_id = ${project.id} and d.visibility = 'shared'
               and c.status <> 'pending' and c.decided_at is not null`,
          tx`select name from public.organizations where id = ${project.clientOrgId}`,
        ]);
        const rows: AcceptanceRow[] = [
          ...gates.map((g): AcceptanceRow => ({
            kind: 'Gate decision',
            name: `Gate ${g.gate} · ${g.phase_name}`,
            outcome: DECISION_LABEL[g.decision as GateDecision],
            details:
              g.decision === 'rejected'
                ? opt(g.reason)
                : g.conditions
                  ? String(g.conditions).split('\n').join('; ')
                  : undefined,
            by: g.by_name ?? '—',
            at: g.decided_at,
            ip: opt(g.ip_text),
          })),
          ...criteria.map((c): AcceptanceRow => ({
            kind: 'Deliverable acceptance',
            name: `${c.deliverable_name}: ${c.text}`,
            outcome: c.status === 'accepted' ? 'Accepted' : 'Rejected',
            details: opt(c.note),
            by: c.by_name ?? '—',
            at: c.decided_at,
            ip: opt(c.ip_text),
          })),
        ].sort((a, b) => a.at.localeCompare(b.at));
        await audit(tx, s, project.id, 'acceptance_record.export', 'project', project.id, undefined, {
          rows: rows.length,
        });
        return {
          projectKey: project.key,
          projectName: project.name,
          clientName: client?.name ?? '—',
          generatedAt: new Date().toISOString(),
          generatedBy: s.user.name,
          rows,
        };
      });
    },
  };
}

let store: AcceptanceRecordStore | undefined;
export const postgresAcceptanceRecordStore = (): AcceptanceRecordStore =>
  (store ??= createPostgresAcceptanceRecordStore(getSql()));
