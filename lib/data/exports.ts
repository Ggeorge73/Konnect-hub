import type { Profile, Session, Sprint, WorkItem } from '../domain/types';
import { canManageProject, isClientRole } from '../domain/permissions';
import { ITEM_TYPES, PRIORITIES, STATUS_LABEL } from '../domain/workflow';
import { RAID_KINDS, RAID_STATUS_LABEL, type RaidKind, type RaidView } from '../domain/raid';
import { RAG_TEXT, filterPortfolio, type PortfolioFilter } from '../domain/dashboard';
import { formatRatio, roundHalfEven } from '../domain/evm';
import { TIME_STATUS_LABEL, canExportTime, canSeeTimeCost, type TimeEntryView } from '../domain/ledger';
import { sortItems, type SortKey } from '../../features/list/tableModel';
import { buildExport, type ExportColumn, type ExportFile, type ExportFormat } from '../export';
import { getRepo } from './index';
import { listRaid } from './raid';
import { getPortfolio, isoDay, type PortfolioRow } from './insight';
import { listApproved, listWeek } from './ledger';
import { listAudit, recordAudit, type AuditQuery, type AuditRow } from './audit';
import { MAX_PAGE_SIZE } from './audit-rules';
import { ForbiddenError, ValidationError } from './errors';

/**
 * CSV / Excel exports for list views (KH-39 EXP-01) and the approved-time export (KH-37).
 * Rows always come from lib/data as the caller (visibility, tenant isolation and RLS apply),
 * then the same columns are written as CSV or XLSX. Every export is audited as
 * `export.csv` / `export.xlsx` with the entity and the row count.
 */
export type ExportEntity = 'items' | 'raid' | 'portfolio' | 'timesheet' | 'time' | 'audit';
export const EXPORT_ENTITIES: ExportEntity[] = ['items', 'raid', 'portfolio', 'timesheet', 'time', 'audit'];

export interface ExportResult extends ExportFile {
  entity: ExportEntity;
}

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? null : roundHalfEven(cents) / 100;

// ---------------------------------------------------------------------------
// Work items (List view; portal shared work list for clients)
// ---------------------------------------------------------------------------
export interface ItemExportQuery {
  project: string;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  q?: string;
  /** Visible column ids of the List view, in order. */
  cols?: string[];
}

type ItemCtx = { people: Profile[]; sprints: Sprint[] };
const ITEM_COLUMNS: Record<string, (c: ItemCtx) => ExportColumn<WorkItem>> = {
  type: () => ({ label: 'Type', value: (i) => ITEM_TYPES.find((t) => t.id === i.type)?.label ?? i.type }),
  key: () => ({ label: 'Key', value: (i) => i.key }),
  title: () => ({ label: 'Title', value: (i) => i.title }),
  status: () => ({ label: 'Status', value: (i) => STATUS_LABEL[i.status] }),
  priority: () => ({
    label: 'Priority',
    value: (i) => PRIORITIES.find((p) => p.id === i.priority)?.label ?? i.priority,
  }),
  assignee: (c) => ({
    label: 'Assignee',
    value: (i) => c.people.find((p) => p.id === i.assigneeId)?.name ?? '',
  }),
  sprint: (c) => ({ label: 'Sprint', value: (i) => c.sprints.find((s) => s.id === i.sprintId)?.name ?? '' }),
  estimate: () => ({ label: 'Estimate', value: (i) => i.estimate }),
  due: () => ({ label: 'Due', value: (i) => i.dueDate ?? '' }),
  labels: () => ({ label: 'Labels', value: (i) => i.labels.join('; ') }),
  visibility: () => ({
    label: 'Visibility',
    value: (i) => (i.visibility === 'shared' ? 'Shared' : 'Internal'),
  }),
};
export const ITEM_COLUMN_IDS = Object.keys(ITEM_COLUMNS);
/** What the portal "Shared work" list shows a client: no internal planning fields. */
export const CLIENT_ITEM_COLUMNS = ['key', 'title', 'type', 'status'];

/**
 * The List view's current rows: filtered by the text filter, sorted like the table, with the
 * visible columns. Clients get exactly the portal "Shared work" list (shared, non-epic items).
 */
export async function itemRows(s: Session, q: ItemExportQuery) {
  const repo = getRepo();
  const bundle = await repo.getProjectBundle(s, q.project.toUpperCase());
  const client = isClientRole(s.user.role);
  let items = await repo.listItems(s, { projectId: bundle.project.id });
  if (client) items = items.filter((i) => i.visibility === 'shared' && i.type !== 'epic' && !i.deletedAt);
  const t = q.q?.trim().toLowerCase();
  if (t) items = items.filter((i) => i.title.toLowerCase().includes(t) || i.key.toLowerCase().includes(t));
  const people = client ? [] : await repo.listPeople(s);
  items = sortItems(items, q.sort ?? 'key', q.dir ?? 'asc', people);
  const allowed = client ? CLIENT_ITEM_COLUMNS : ITEM_COLUMN_IDS;
  const wanted = (q.cols?.length ? q.cols : allowed).filter((c) => allowed.includes(c));
  const ctx = { people, sprints: bundle.sprints };
  return {
    project: bundle.project,
    items,
    columns: (wanted.length ? wanted : allowed).map((id) => ITEM_COLUMNS[id](ctx)),
  };
}

// ---------------------------------------------------------------------------
// RAID register
// ---------------------------------------------------------------------------
const RAID_COLUMNS: ExportColumn<RaidView & { ownerName: string }>[] = [
  { label: 'Kind', value: (e) => RAID_KINDS.find((k) => k.id === e.kind)?.label ?? e.kind },
  { label: 'Title', value: (e) => e.title },
  { label: 'Status', value: (e) => RAID_STATUS_LABEL[e.status] },
  { label: 'Owner', value: (e) => e.ownerName },
  { label: 'Category', value: (e) => e.category ?? '' },
  { label: 'Score', value: (e) => e.score },
  { label: 'Residual score', value: (e) => e.residualScore },
  { label: 'Severity', value: (e) => e.severity ?? '' },
  { label: 'SLA due', value: (e) => e.slaDue ?? '' },
  { label: 'Mitigation', value: (e) => e.mitigation ?? '' },
  { label: 'Visibility', value: (e) => (e.visibility === 'shared' ? 'Shared' : 'Internal') },
  { label: 'Linked items', value: (e) => e.linkedItemIds.length },
  { label: 'Created', value: (e) => e.createdAt.slice(0, 10) },
];

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
const TIMESHEET_COLUMNS: ExportColumn<TimeEntryView>[] = [
  { label: 'Date', value: (e) => e.date },
  { label: 'Project', value: (e) => e.projectKey },
  { label: 'Item', value: (e) => e.itemKey ?? '' },
  { label: 'Title', value: (e) => e.itemTitle ?? '' },
  { label: 'Hours', value: (e) => e.hours },
  { label: 'Billable', value: (e) => e.billable },
  { label: 'Note', value: (e) => e.note },
  { label: 'Status', value: (e) => TIME_STATUS_LABEL[e.status] },
];

/** Invoicing columns. Rate and cost are appended for Admins only (canSeeTimeCost). */
export function approvedTimeColumns(viewer: Profile): ExportColumn<TimeEntryView>[] {
  const base: ExportColumn<TimeEntryView>[] = [
    { label: 'Person', value: (e) => e.userName },
    { label: 'Project', value: (e) => e.projectKey },
    { label: 'Item', value: (e) => e.itemKey ?? '' },
    { label: 'Date', value: (e) => e.date },
    { label: 'Hours', value: (e) => e.hours },
    { label: 'Billable', value: (e) => e.billable },
    { label: 'Note', value: (e) => e.note },
    { label: 'Approved by', value: (e) => e.decidedByName ?? '' },
    { label: 'Approved at', value: (e) => e.decidedAt ?? '' },
  ];
  if (!canSeeTimeCost(viewer)) return base;
  return [
    ...base,
    { label: 'Cost rate', value: (e) => e.costRate ?? null },
    { label: 'Cost', value: (e) => money(e.costCents) },
  ];
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
const AUDIT_COLUMNS: ExportColumn<AuditRow>[] = [
  { label: 'Time', value: (a) => a.at },
  { label: 'Actor', value: (a) => a.actorName },
  { label: 'Action', value: (a) => a.action },
  { label: 'Entity', value: (a) => a.entity },
  { label: 'Entity id', value: (a) => a.entityId },
  { label: 'IP', value: (a) => a.ip ?? '' },
  { label: 'Before', value: (a) => (a.before === undefined ? '' : JSON.stringify(a.before)) },
  { label: 'After', value: (a) => (a.after === undefined ? '' : JSON.stringify(a.after)) },
];

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
function portfolioColumns(moneyVisible: boolean): ExportColumn<PortfolioRow>[] {
  return [
    { label: 'Key', value: (r) => r.key },
    { label: 'Project', value: (r) => r.name },
    { label: 'Client', value: (r) => r.clientName },
    { label: 'Lead', value: (r) => r.leadName },
    { label: 'RAG', value: (r) => RAG_TEXT[r.rag] },
    { label: 'Gate', value: (r) => `${r.gate} ${r.gateName}` },
    ...(moneyVisible ? [{ label: 'Budget variance (VAC)', value: (r: PortfolioRow) => money(r.vac) }] : []),
    { label: 'SPI', value: (r) => (r.spi === null ? 'n/a' : Number(formatRatio(r.spi))) },
    { label: 'CPI', value: (r) => (r.cpi === null ? 'n/a' : Number(formatRatio(r.cpi))) },
    { label: 'Critical risks', value: (r) => r.criticalRisks },
    { label: '% complete', value: (r) => Math.round(r.percentComplete * 10) / 10 },
  ];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const str = (p: URLSearchParams, k: string) => p.get(k) ?? undefined;

/**
 * Builds the file for one export and audits it. `params` are the route's query string
 * (filters / sort / columns as the list view has them).
 */
export async function runExport(
  s: Session,
  entity: ExportEntity,
  format: ExportFormat,
  params: URLSearchParams,
  ip?: string,
): Promise<ExportResult> {
  let file: ExportFile;
  let projectId: string | null = null;
  let entityId: string = entity;
  const filters: Record<string, string> = {};
  const today = isoDay(new Date());

  switch (entity) {
    case 'items': {
      const project = str(params, 'project');
      if (!project) throw new ValidationError('Choose a project.');
      const sort = str(params, 'sort') as SortKey | undefined;
      const r = await itemRows(s, {
        project,
        sort,
        dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
        q: str(params, 'q'),
        cols: params.get('cols')?.split(',').filter(Boolean),
      });
      projectId = entityId = r.project.id;
      if (params.get('q')) filters.q = params.get('q')!;
      file = await buildExport(format, `${r.project.key}-items-${today}`, r.columns, r.items, 'Items');
      break;
    }
    case 'raid': {
      const project = str(params, 'project');
      if (!project) throw new ValidationError('Choose a project.');
      const bundle = await getRepo().getProjectBundle(s, project.toUpperCase());
      const kind = str(params, 'kind') as RaidKind | undefined;
      if (kind && !RAID_KINDS.some((k) => k.id === kind)) throw new ValidationError('Unknown RAID kind.');
      const rows = (await listRaid(s, { projectId: bundle.project.id }))
        .filter((e) => !kind || e.kind === kind)
        .map((e) => ({ ...e, ownerName: bundle.people.find((p) => p.id === e.ownerId)?.name ?? '' }));
      projectId = entityId = bundle.project.id;
      if (kind) filters.kind = kind;
      const label = RAID_KINDS.find((k) => k.id === kind)?.plural ?? 'RAID';
      file = await buildExport(format, `${bundle.project.key}-${label}-${today}`, RAID_COLUMNS, rows, label);
      break;
    }
    case 'portfolio': {
      const v = await getPortfolio(s);
      const f: PortfolioFilter = {
        clientId: str(params, 'clientId'),
        leadId: str(params, 'leadId'),
        rag: str(params, 'rag') as PortfolioFilter['rag'],
      };
      for (const [k, val] of Object.entries(f)) if (val) filters[k] = val;
      file = await buildExport(
        format,
        `portfolio-${v.asOf}`,
        portfolioColumns(v.money),
        filterPortfolio(v.rows, f),
        'Portfolio',
      );
      break;
    }
    case 'timesheet': {
      const week = str(params, 'week');
      if (!week) throw new ValidationError('Choose a week.');
      filters.week = week;
      file = await buildExport(
        format,
        `timesheet-${week}`,
        TIMESHEET_COLUMNS,
        await listWeek(s, week),
        'Timesheet',
      );
      break;
    }
    case 'time': {
      if (!canExportTime(s.user))
        throw new ForbiddenError('Only Admins and Delivery Leads export approved time.');
      const f = { projectKey: str(params, 'project'), from: str(params, 'from'), to: str(params, 'to') };
      for (const [k, val] of Object.entries(f)) if (val) filters[k] = val;
      const rows = await listApproved(s, f);
      file = await buildExport(
        format,
        `approved-time-${f.projectKey ?? 'all'}-${today}`,
        approvedTimeColumns(s.user),
        rows,
        'Approved time',
      );
      break;
    }
    case 'audit': {
      const q: AuditQuery = {
        actorId: str(params, 'actor'),
        actionPrefix: str(params, 'action'),
        from: str(params, 'from'),
        to: str(params, 'to'),
        pageSize: MAX_PAGE_SIZE,
      };
      for (const [k, val] of Object.entries(q)) if (val && k !== 'pageSize') filters[k] = String(val);
      const page = await listAudit(s, q);
      file = await buildExport(format, `audit-log-${today}`, AUDIT_COLUMNS, page.rows, 'Audit log');
      break;
    }
  }

  await recordAudit(
    s,
    {
      action: `export.${format}`,
      entity,
      entityId,
      projectId,
      after: { entity, rows: file.rowCount, ...(Object.keys(filters).length ? { filters } : {}) },
    },
    ip,
  );
  return { ...file, entity };
}

/** Lead/Admin check for the full project JSON export. */
export const canExportProject = canManageProject;
