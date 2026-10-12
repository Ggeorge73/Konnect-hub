import type { Project, Rag, Session } from '../domain/types';
import { canSeeFinancials, canSeeProject, isClientRole } from '../domain/permissions';
import { addDays, isoDay, weekStart as mondayOf } from '../domain/metrics';
import {
  buildStatusDraft,
  canDraftReports,
  canPublishReport,
  internalRefs,
  redactForClient,
  reportWeekEnd,
  type RemovalEntry,
  type ReportSections,
  type ReportStatus,
  type StatusReport,
} from '../domain/reports';
import type { Notification } from '../domain/notifications';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';

/**
 * Weekly status reports (RPT-01), demo store. Mirrors supabase/migrations/0007_pulse.sql:
 * internal users on the project draft; only the project Lead or an Admin publishes; client users
 * read published reports of their own org, and only the client copy frozen at publish.
 */

const iso = (d: Date) => d.toISOString();

function visibleProject(s: Session, keyOrId: string): Project {
  const d = db();
  const p = d.projects.find((x) => (x.id === keyOrId || x.key === keyOrId.toUpperCase()) && !x.deletedAt);
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

const nameOf = (id?: string | null) => db().profiles.find((p) => p.id === id)?.name ?? '—';

export interface ReportSummary {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  status: ReportStatus;
  rag: Rag;
  authorName: string;
  publishedAt: string | null;
}

/** What a caller receives for one report. Client users get the client copy only. */
export interface ReportView {
  id: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  status: ReportStatus;
  rag: Rag;
  ragReason: string;
  sections: Partial<ReportSections>;
  shareBudget: boolean;
  authorName: string;
  publishedAt: string | null;
  publishedByName: string | null;
  updatedAt: string;
  /** Removed from the client copy at publish (internal users only). */
  removed: RemovalEntry[];
  canEdit: boolean;
  canPublish: boolean;
  /** True when the viewer may not see the internal budget section. */
  budgetHidden: boolean;
}

function summary(r: StatusReport, p: Project): ReportSummary {
  return {
    id: r.id,
    projectId: p.id,
    projectKey: p.key,
    projectName: p.name,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    status: r.status,
    rag: r.rag,
    authorName: nameOf(r.authorId),
    publishedAt: r.publishedAt,
  };
}

function view(s: Session, r: StatusReport, p: Project): ReportView {
  const client = isClientRole(s.user.role);
  const budgetHidden = !client && !canSeeFinancials(s.user);
  let sections: Partial<ReportSections>;
  if (client) sections = { ...(r.clientSections ?? {}) };
  else {
    sections = { ...r.sections };
    if (budgetHidden) delete sections.budget;
  }
  return {
    id: r.id,
    projectId: p.id,
    projectKey: p.key,
    projectName: p.name,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    status: r.status,
    rag: r.rag,
    ragReason: client ? (r.clientRagReason ?? '') : r.ragReason,
    sections,
    shareBudget: client ? false : r.shareBudget,
    authorName: nameOf(r.authorId),
    publishedAt: r.publishedAt,
    publishedByName: r.publishedBy ? nameOf(r.publishedBy) : null,
    updatedAt: r.updatedAt,
    removed: client ? [] : r.removed,
    canEdit: !client && canDraftReports(s.user) && r.status === 'draft',
    canPublish: !client && canPublishReport(s.user, p) && r.status === 'draft',
    budgetHidden,
  };
}

/** A report the caller may read: clients see published reports of their org's projects only. */
function findVisible(s: Session, id: string): { report: StatusReport; project: Project } {
  const r = db().statusReports.find((x) => x.id === id);
  if (!r || (isClientRole(s.user.role) && r.status !== 'published'))
    throw new NotFoundError('Report not found');
  return { report: r, project: visibleProject(s, r.projectId) };
}

export async function listReports(s: Session, f: { project?: string } = {}): Promise<ReportSummary[]> {
  const d = db();
  const projects = f.project
    ? [visibleProject(s, f.project)]
    : d.projects.filter((p) => !p.deletedAt && canSeeProject(s.user, p, d.members));
  const byId = new Map(projects.map((p) => [p.id, p]));
  return d.statusReports
    .filter((r) => byId.has(r.projectId) && (!isClientRole(s.user.role) || r.status === 'published'))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.projectId.localeCompare(b.projectId))
    .map((r) => summary(r, byId.get(r.projectId)!));
}

export interface ReportGrid {
  weeks: string[];
  projects: { id: string; key: string; name: string; canDraft: boolean; canPublish: boolean }[];
  reports: ReportSummary[];
}

/** Projects × the last `weeks` reporting weeks (newest first), for the internal Reports page. */
export async function reportGrid(s: Session, weeks = 4, now: Date = new Date()): Promise<ReportGrid> {
  if (isClientRole(s.user.role)) throw new ForbiddenError('Client users read reports in the portal.');
  const d = db();
  const current = mondayOf(isoDay(now));
  const projects = d.projects.filter((p) => !p.deletedAt && canSeeProject(s.user, p, d.members));
  return {
    weeks: Array.from({ length: weeks }, (_, k) => addDays(current, -7 * k)),
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      canDraft: canDraftReports(s.user),
      canPublish: canPublishReport(s.user, p),
    })),
    reports: await listReports(s),
  };
}

export async function getReport(s: Session, id: string): Promise<ReportView> {
  const { report, project } = findVisible(s, id);
  return view(s, report, project);
}

/**
 * "Generate draft": builds the report for the project's week (default: this week) from that week's
 * activity. Returns the existing draft if there is one; a published week cannot be regenerated.
 */
export async function generateDraft(
  s: Session,
  projectKey: string,
  week?: string,
  now: Date = new Date(),
): Promise<ReportView> {
  const p = visibleProject(s, projectKey);
  if (!canDraftReports(s.user)) throw new ForbiddenError('Only the delivery team can draft status reports.');
  const weekStart = mondayOf(week ?? isoDay(now));
  const d = db();
  const existing = d.statusReports.find((r) => r.projectId === p.id && r.weekStart === weekStart);
  if (existing?.status === 'published')
    throw new ValidationError('The report for this week is already published.');
  if (existing) return view(s, existing, p);
  const draft = buildStatusDraft({
    project: p,
    weekStart,
    items: d.items.filter((i) => i.projectId === p.id && !i.deletedAt),
    history: d.statusHistory.filter((h) => h.projectId === p.id),
    sprints: d.sprints.filter((x) => x.projectId === p.id),
    phases: d.phases.filter((x) => x.projectId === p.id),
    raid: d.raid.filter((r) => r.projectId === p.id),
    gateReviews: d.gateReviews.filter((g) => g.projectId === p.id),
    deliverables: d.deliverables.filter((x) => x.projectId === p.id),
    now,
  });
  const t = iso(now);
  const report: StatusReport = {
    id: newId('sr'),
    projectId: p.id,
    weekStart,
    weekEnd: reportWeekEnd(weekStart),
    status: 'draft',
    rag: draft.rag,
    ragReason: draft.ragReason,
    sections: draft.sections,
    shareBudget: false,
    authorId: s.user.id,
    createdAt: t,
    updatedAt: t,
    publishedAt: null,
    publishedBy: null,
    clientSections: null,
    clientRagReason: null,
    removed: [],
  };
  d.statusReports.push(report);
  d.activity.push({
    id: newId('ac'),
    projectId: p.id,
    actorId: s.user.id,
    action: 'report.drafted',
    detail: `Status report drafted for the week of ${weekStart}`,
    at: t,
  });
  return view(s, report, p);
}

export interface ReportPatch {
  sections?: Partial<ReportSections>;
  rag?: Rag;
  ragReason?: string;
}

export async function updateReport(
  s: Session,
  id: string,
  patch: ReportPatch,
  now: Date = new Date(),
): Promise<ReportView> {
  const { report, project } = findVisible(s, id);
  if (!canDraftReports(s.user)) throw new ForbiddenError('Only the delivery team can edit status reports.');
  if (report.status !== 'draft') throw new ValidationError('Published reports cannot be edited.');
  if (patch.sections?.budget !== undefined && !canSeeFinancials(s.user))
    throw new ForbiddenError('Only Leads and Admins can edit the budget section.');
  report.sections = { ...report.sections, ...patch.sections };
  if (patch.rag) report.rag = patch.rag;
  if (patch.ragReason !== undefined) report.ragReason = patch.ragReason.trim();
  report.updatedAt = iso(now);
  return view(s, report, project);
}

function clientCopy(report: StatusReport, project: Project, shareBudget: boolean) {
  const d = db();
  const refs = internalRefs(
    d.items.filter((i) => i.projectId === project.id),
    d.raid.filter((r) => r.projectId === project.id),
  );
  return redactForClient(report.sections, refs, shareBudget, report.ragReason);
}

const clientRecipients = (p: Project) =>
  db()
    .profiles.filter((u) => u.orgId === p.clientOrgId && isClientRole(u.role))
    .map((u) => u.id);

export interface PublishCheck {
  removed: RemovalEntry[];
  recipients: number;
}

/** The pre-publish checklist: what the client copy will leave out, and who will be notified. */
export async function publishCheck(s: Session, id: string, shareBudget = false): Promise<PublishCheck> {
  const { report, project } = findVisible(s, id);
  if (!canPublishReport(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can publish status reports.');
  return {
    removed: clientCopy(report, project, shareBudget).removed,
    recipients: clientRecipients(project).length,
  };
}

/**
 * Publishes to the client portal: freezes the client copy (internal content removed), records an
 * audit entry, and notifies every client user of the project's org (email is a later story).
 */
export async function publishReport(
  s: Session,
  id: string,
  opts: { shareBudget?: boolean } = {},
  now: Date = new Date(),
): Promise<ReportView> {
  const { report, project } = findVisible(s, id);
  if (!canPublishReport(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can publish status reports.');
  if (report.status === 'published') throw new ValidationError('This report is already published.');
  const shareBudget = Boolean(opts.shareBudget);
  const copy = clientCopy(report, project, shareBudget);
  const t = iso(now);
  Object.assign(report, {
    status: 'published' as const,
    shareBudget,
    clientSections: copy.sections,
    clientRagReason: copy.ragReason,
    removed: copy.removed,
    publishedAt: t,
    publishedBy: s.user.id,
    updatedAt: t,
  });
  const d = db();
  d.audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action: 'status_report.publish',
    entity: 'status_report',
    entityId: report.id,
    before: { status: 'draft' },
    after: { status: 'published', shareBudget, removed: copy.removed.map((r) => r.label) },
    at: t,
  });
  d.activity.push({
    id: newId('ac'),
    projectId: project.id,
    actorId: s.user.id,
    action: 'report.published',
    detail: `Status report for the week of ${report.weekStart} published to the client`,
    at: t,
  });
  const notes: Notification[] = clientRecipients(project).map((userId) => ({
    id: newId('nt'),
    userId,
    projectId: project.id,
    kind: 'status_report_published',
    title: `Status report published: ${project.name}, week of ${report.weekStart}`,
    href: `/portal/${project.key}/reports/${report.id}`,
    createdAt: t,
    readAt: null,
  }));
  d.notifications.push(...notes);
  return view(s, report, project);
}
