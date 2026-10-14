import type { Project, Session } from '../domain/types';
import { canSeeFinancials, isClientRole } from '../domain/permissions';
import { addDays, isoDay, weekStart as mondayOf, type StatusChange } from '../domain/metrics';
import {
  buildStatusDraft,
  canDraftReports,
  canPublishReport,
  internalRefs,
  redactForClient,
  reportWeekEnd,
  type ReportSections,
  type StatusReport,
} from '../domain/reports';
import { reportSummary, reportView, type NameOf, type ReportStore } from './reports';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { RAID_SELECT, toEntry } from './raid-postgres';
import {
  asUser,
  findProject,
  getSql,
  inServiceScope,
  jsonb,
  logActivity,
  textArray,
  toPhase,
  toProject,
  toSprint,
  uuidOr,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Weekly status reports on Postgres + RLS (KH-51, tables from 0007 and 0013):
 *   status_reports         one row per project and week; once published it is the client copy
 *                          (sections, rag_reason), readable by the project's client users
 *   status_report_drafts   the internal working copy, the internal RAG reason and what publish removed
 *   status_report_budgets  the budget section (Leads and Admins only)
 * Publishing goes through the 0007 triggers: only the project Lead or an Admin may publish, and the
 * publish writes the audit entry and the in-app notifications for the client users.
 */

const REPORT_SELECT = (tx: Tx) => tx`
  select r.*, d.sections as draft_sections, d.removed, d.rag_reason as draft_rag_reason,
         b.html as budget_html
  from public.status_reports r
  left join public.status_report_drafts d on d.report_id = r.id
  left join public.status_report_budgets b on b.report_id = r.id`;

function toReport(r: Row): StatusReport {
  const published = r.status === 'published';
  const sections = { ...(r.draft_sections ?? {}) } as ReportSections;
  if (r.budget_html != null) sections.budget = r.budget_html;
  return {
    id: r.id,
    projectId: r.project_id,
    weekStart: r.week_start,
    weekEnd: r.period_end ?? reportWeekEnd(r.week_start),
    status: published ? 'published' : 'draft',
    rag: r.rag,
    ragReason: r.draft_rag_reason ?? r.rag_reason ?? '',
    sections,
    shareBudget: r.share_budget,
    authorId: r.author_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at ?? null,
    publishedBy: r.published_by ?? null,
    clientSections: published ? (r.sections ?? {}) : null,
    clientRagReason: published ? (r.rag_reason ?? '') : null,
    removed: r.removed ?? [],
  };
}

async function visibleProject(tx: Tx, keyOrId: string): Promise<Project> {
  const p = await findProject(tx, keyOrId);
  if (p.deletedAt) throw new NotFoundError('Project not found');
  return p;
}

async function names(tx: Tx): Promise<NameOf> {
  const rows = await tx`select id, name from public.profiles`;
  const byId = new Map(rows.map((r) => [r.id as string, r.name as string]));
  return (id) => (id && byId.get(id)) || '—';
}

/** A report the caller may read. RLS hides drafts (internal rows) from client users. */
async function findVisible(tx: Tx, s: Session, id: string) {
  const [row] = await tx`${REPORT_SELECT(tx)} where r.id = ${uuidOr(id)}`;
  if (!row || (isClientRole(s.user.role) && row.status !== 'published'))
    throw new NotFoundError('Report not found');
  return { report: toReport(row), project: await visibleProject(tx, row.project_id) };
}

/** Client copy at publish: internal items and RAID entries of the project are redacted. */
async function clientCopy(tx: Tx, report: StatusReport, project: Project, shareBudget: boolean) {
  const [items, raid] = await Promise.all([
    tx`select key, title, visibility, deleted_at from public.work_items where project_id = ${project.id}`,
    tx`select kind, title, visibility from public.raid_entries where project_id = ${project.id}`,
  ]);
  const refs = internalRefs(
    items.map((i) => ({ key: i.key, title: i.title, visibility: i.visibility, deletedAt: i.deleted_at })),
    raid.map((r) => ({ kind: r.kind, title: r.title, visibility: r.visibility })),
  );
  return redactForClient(report.sections, refs, shareBudget, report.ragReason);
}

/** Client users of the project's org (notified at publish by the 0007 trigger). */
async function clientRecipientCount(tx: Tx, project: Project): Promise<number> {
  const [{ n }] = await inServiceScope(
    tx,
    (tx) => tx`select count(*)::int as n from public.profiles
               where org_id = ${project.clientOrgId}
                 and role in ('client_sponsor', 'client_member', 'client_viewer')`,
  );
  return n;
}

const requirePublisher = (s: Session, project: Project) => {
  if (!canPublishReport(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can publish status reports.');
};

export function createPostgresReportStore(sql: Sql): ReportStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  async function list(tx: Tx, s: Session, f: { project?: string }) {
    const projects = f.project
      ? [await visibleProject(tx, f.project)]
      : (
          await tx`select p.*, f.bac from public.projects p
                   left join public.project_financials f on f.project_id = p.id
                   where p.deleted_at is null order by p.created_at`
        ).map(toProject);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const rows = await tx`${REPORT_SELECT(tx)}
      where r.project_id = any(${textArray([...byId.keys()])}::uuid[])
      order by r.week_start desc, r.project_id`;
    const nameOf = await names(tx);
    return {
      projects,
      reports: rows
        .map(toReport)
        .filter((r) => !isClientRole(s.user.role) || r.status === 'published')
        .map((r) => reportSummary(r, byId.get(r.projectId)!, nameOf)),
    };
  }

  async function viewOf(tx: Tx, s: Session, id: string) {
    const { report, project } = await findVisible(tx, s, id);
    return reportView(s, report, project, await names(tx));
  }

  return {
    async listReports(s, f = {}) {
      return run(s, async (tx) => (await list(tx, s, f)).reports);
    },

    async reportGrid(s, weeks = 4, now = new Date()) {
      if (isClientRole(s.user.role)) throw new ForbiddenError('Client users read reports in the portal.');
      return run(s, async (tx) => {
        const current = mondayOf(isoDay(now));
        const { projects, reports } = await list(tx, s, {});
        return {
          weeks: Array.from({ length: weeks }, (_, k) => addDays(current, -7 * k)),
          projects: projects.map((p) => ({
            id: p.id,
            key: p.key,
            name: p.name,
            canDraft: canDraftReports(s.user),
            canPublish: canPublishReport(s.user, p),
          })),
          reports,
        };
      });
    },

    async getReport(s, id) {
      return run(s, (tx) => viewOf(tx, s, id));
    },

    async generateDraft(s, projectKey, week, now = new Date()) {
      return run(s, async (tx) => {
        const p = await visibleProject(tx, projectKey);
        if (!canDraftReports(s.user))
          throw new ForbiddenError('Only the delivery team can draft status reports.');
        const weekStart = mondayOf(week ?? isoDay(now));
        const [existing] = await tx`
          select id, status from public.status_reports where project_id = ${p.id} and week_start = ${weekStart}`;
        if (existing?.status === 'published')
          throw new ValidationError('The report for this week is already published.');
        if (existing) return viewOf(tx, s, existing.id);

        const [items, history, sprints, phases, raid, reviews, deliverables, [fin]] = await Promise.all([
          tx`select id, key, title, type, status, estimate, sprint_id, created_at, deleted_at, due_date, visibility
             from public.work_items where project_id = ${p.id} and deleted_at is null`,
          tx`select * from public.status_history where project_id = ${p.id} order by at, id`,
          tx`select * from public.sprints where project_id = ${p.id} order by start_date`,
          tx`select * from public.phases where project_id = ${p.id} order by gate`,
          tx`${RAID_SELECT(tx)} where r.project_id = ${p.id}`,
          tx`select ph.gate, g.status, coalesce(g.requested_at, g.decided_at) as requested_at
             from public.gate_reviews g join public.phases ph on ph.id = g.phase_id
             where g.project_id = ${p.id}`,
          tx`select name, status, due_date, visibility from public.deliverables where project_id = ${p.id}`,
          // The budget section is written from BAC whoever drafts; only Leads/Admins can read it back.
          inServiceScope(
            tx,
            (tx) => tx`select bac from public.project_financials where project_id = ${p.id}`,
          ),
        ]);
        const draft = buildStatusDraft({
          project: { ...p, bac: Number(fin?.bac ?? p.bac) },
          weekStart,
          items: items.map((i) => ({
            id: i.id,
            key: i.key,
            title: i.title,
            type: i.type,
            status: i.status,
            estimate: i.estimate == null ? null : Number(i.estimate),
            sprintId: i.sprint_id ?? null,
            createdAt: i.created_at,
            deletedAt: i.deleted_at ?? null,
            dueDate: i.due_date ?? null,
            visibility: i.visibility,
          })),
          history: history.map((h): StatusChange => ({
            id: h.id,
            projectId: h.project_id,
            itemId: h.item_id,
            from: h.from_status ?? null,
            to: h.to_status,
            at: h.at,
          })),
          sprints: sprints.map(toSprint),
          phases: phases.map(toPhase),
          raid: raid.map(toEntry),
          gateReviews: reviews.map((g) => ({ gate: g.gate, status: g.status, requestedAt: g.requested_at })),
          deliverables: deliverables.map((d) => ({
            name: d.name,
            status: d.status,
            dueDate: d.due_date ?? null,
            visibility: d.visibility,
          })),
          now,
        });
        const { budget, ...working } = draft.sections;
        const [row] = await tx`
          insert into public.status_reports (project_id, period_start, period_end, rag, rag_reason,
                                             visibility, author_id)
          values (${p.id}, ${weekStart}, ${reportWeekEnd(weekStart)}, ${draft.rag}, '', 'internal', ${s.user.id})
          returning id`;
        await tx`insert into public.status_report_drafts (report_id, project_id, sections, rag_reason)
                 values (${row.id}, ${p.id}, ${jsonb(tx, working)}::jsonb, ${draft.ragReason})`;
        await inServiceScope(
          tx,
          (tx) => tx`insert into public.status_report_budgets (report_id, project_id, html)
                     values (${row.id}, ${p.id}, ${budget})`,
        );
        await logActivity(
          tx,
          s,
          p.id,
          'report.drafted',
          `Status report drafted for the week of ${weekStart}`,
          'internal',
        );
        return viewOf(tx, s, row.id);
      });
    },

    async updateReport(s, id, patch) {
      return run(s, async (tx) => {
        const { report, project } = await findVisible(tx, s, id);
        if (!canDraftReports(s.user))
          throw new ForbiddenError('Only the delivery team can edit status reports.');
        if (report.status !== 'draft') throw new ValidationError('Published reports cannot be edited.');
        if (patch.sections?.budget !== undefined && !canSeeFinancials(s.user))
          throw new ForbiddenError('Only Leads and Admins can edit the budget section.');
        const { budget, ...rest } = patch.sections ?? {};
        const { budget: _old, ...working } = report.sections;
        await tx`
          insert into public.status_report_drafts (report_id, project_id, sections, rag_reason)
          values (${report.id}, ${project.id}, ${jsonb(tx, { ...working, ...rest })}::jsonb,
                  ${patch.ragReason !== undefined ? patch.ragReason.trim() : report.ragReason})
          on conflict (report_id) do update
            set sections = excluded.sections, rag_reason = excluded.rag_reason, updated_at = now()`;
        if (budget !== undefined)
          await tx`
            insert into public.status_report_budgets (report_id, project_id, html)
            values (${report.id}, ${project.id}, ${budget})
            on conflict (report_id) do update set html = excluded.html`;
        // Always touches the row so updated_at moves (status_reports_publish_guard stamps it).
        await tx`update public.status_reports set rag = ${patch.rag ?? report.rag} where id = ${report.id}`;
        return viewOf(tx, s, report.id);
      });
    },

    async publishCheck(s, id, shareBudget = false) {
      return run(s, async (tx) => {
        const { report, project } = await findVisible(tx, s, id);
        requirePublisher(s, project);
        return {
          removed: (await clientCopy(tx, report, project, shareBudget)).removed,
          recipients: await clientRecipientCount(tx, project),
        };
      });
    },

    async publishReport(s, id, opts = {}, now = new Date()) {
      return run(s, async (tx) => {
        const { report, project } = await findVisible(tx, s, id);
        requirePublisher(s, project);
        if (report.status === 'published') throw new ValidationError('This report is already published.');
        const shareBudget = Boolean(opts.shareBudget);
        const copy = await clientCopy(tx, report, project, shareBudget);
        // The 0007 triggers check the publisher, stamp published_by, audit, and notify the clients.
        await tx`
          update public.status_reports
          set published_at = ${now.toISOString()}, visibility = 'shared', share_budget = ${shareBudget},
              sections = ${jsonb(tx, copy.sections)}::jsonb, rag_reason = ${copy.ragReason},
              published_by = ${s.user.id}
          where id = ${report.id}`;
        const { budget: _budget, ...working } = report.sections;
        await tx`
          insert into public.status_report_drafts (report_id, project_id, sections, rag_reason, removed)
          values (${report.id}, ${project.id}, ${jsonb(tx, working)}::jsonb, ${report.ragReason},
                  ${jsonb(tx, copy.removed)}::jsonb)
          on conflict (report_id) do update set removed = excluded.removed, updated_at = now()`;
        await logActivity(
          tx,
          s,
          project.id,
          'report.published',
          `Status report for the week of ${report.weekStart} published to the client`,
          'shared',
        );
        return viewOf(tx, s, report.id);
      });
    },
  };
}

let store: ReportStore | undefined;
export const postgresReportStore = (): ReportStore => (store ??= createPostgresReportStore(getSql()));
