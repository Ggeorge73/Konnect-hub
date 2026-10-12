import type { Session } from '../domain/types';
import { isClientRole } from '../domain/permissions';
import { DECISION_LABEL } from '../domain/gates';
import { db } from './memory';
import { ForbiddenError } from './errors';
import { requireVisibleProject, writeAudit } from './gates';

export interface AcceptanceRow {
  kind: 'Gate decision' | 'Deliverable acceptance';
  name: string;
  outcome: string;
  details?: string;
  by: string;
  at: string;
  ip?: string;
}

export interface AcceptanceRecord {
  projectKey: string;
  projectName: string;
  clientName: string;
  generatedAt: string;
  generatedBy: string;
  rows: AcceptanceRow[];
}

/**
 * Gate decisions and deliverable acceptances for the PDF record (PDF-01).
 * The record is shareable with the client, so internal-only content (internal deliverables,
 * override notes, budget) is never included, whoever exports it.
 */
export async function buildAcceptanceRecord(s: Session, key: string): Promise<AcceptanceRecord> {
  const project = requireVisibleProject(s, key);
  if (isClientRole(s.user.role) && s.user.role !== 'client_sponsor')
    throw new ForbiddenError('Only the Client Sponsor can download the Acceptance Record.');
  const d = db();
  const name = (id?: string) => d.profiles.find((p) => p.id === id)?.name ?? '—';
  const rows: AcceptanceRow[] = [];
  for (const r of d.gateReviews)
    if (r.projectId === project.id && r.status === 'decided' && r.decision) {
      const ph = d.phases.find((p) => p.id === r.phaseId);
      rows.push({
        kind: 'Gate decision',
        name: `Gate ${r.gate} · ${ph?.name ?? ''}`,
        outcome: DECISION_LABEL[r.decision],
        details: r.decision === 'rejected' ? r.reason : r.conditions?.join('; '),
        by: name(r.decidedBy),
        at: r.decidedAt!,
        ip: r.ip,
      });
    }
  for (const del of d.deliverables)
    if (del.projectId === project.id && del.visibility === 'shared')
      for (const c of del.criteria)
        if (c.status !== 'pending' && c.decidedAt)
          rows.push({
            kind: 'Deliverable acceptance',
            name: `${del.name}: ${c.text}`,
            outcome: c.status === 'accepted' ? 'Accepted' : 'Rejected',
            details: c.note,
            by: name(c.decidedBy),
            at: c.decidedAt,
            ip: c.ip,
          });
  rows.sort((a, b) => a.at.localeCompare(b.at));
  const record: AcceptanceRecord = {
    projectKey: project.key,
    projectName: project.name,
    clientName: d.orgs.find((o) => o.id === project.clientOrgId)?.name ?? '—',
    generatedAt: new Date().toISOString(),
    generatedBy: s.user.name,
    rows,
  };
  writeAudit(s, 'acceptance_record.export', 'project', project.id, undefined, { rows: rows.length });
  return record;
}
