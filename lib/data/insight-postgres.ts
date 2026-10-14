import type { AuditEntry, Phase, Project, Session } from '../domain/types';
import { canManageProject, canSeeFinancials } from '../domain/permissions';
import { phaseBaseline, type EvBaselineEntry } from '../domain/evm';
import { canSeePortfolio, ragOverrideError, RAG_TEXT } from '../domain/dashboard';
import { canSeeDeliverable, type Deliverable } from '../domain/deliverables';
import { isPassed } from '../domain/gates';
import { deriveRaid } from '../domain/raid';
import {
  assembleDashboard,
  assemblePortfolio,
  evmFrom,
  isoDay,
  portfolioRow,
  type EvmInputs,
  type InsightStore,
} from './insight';
import { ForbiddenError, ValidationError } from './errors';
import { safeIp } from './gates-postgres';
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
  uuidOrNull,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Executive dashboard, EVM and portfolio on Postgres + RLS (KH-51). Each call is one transaction
 * as the signed-in user, so RLS decides which items, RAID entries and deliverables feed the
 * dashboard; the shared assembly in insight.ts then applies the same money redaction as the demo
 * store.
 *
 * EVM inputs (BAC, the deliverable-weighted baseline, actual cost from time x cost rate) come
 * from the server-only `project_evm_inputs()` (0013) after RLS has confirmed the caller can see
 * the project: team members get SPI/CPI without ever receiving BAC or cost rates, which their own
 * RLS hides. RAG override and budget sharing write `projects` (RLS: Lead/Admin); the 0006/0013
 * trigger requires the reason and writes the audit entries, with the client IP.
 */

const FORBIDDEN = 'Only the project Lead or an Admin can change the dashboard.';

/** EVM inputs: deliverables with an EV weight, else linear across phases (as the demo store). */
async function evmInputs(tx: Tx, project: Project, phases: Phase[]): Promise<EvmInputs> {
  const [{ j }] = await inServiceScope(tx, (tx) => tx`select public.project_evm_inputs(${project.id}) as j`);
  const milestones = (j.milestones ?? []) as Row[];
  const baseline: EvBaselineEntry[] = milestones.length
    ? milestones.map((m) => ({
        id: m.id,
        name: m.name,
        weight: Number(m.weight),
        startDate: m.start_date,
        dueDate: m.due_date,
        percentComplete: Number(m.percent_complete),
      }))
    : phaseBaseline(
        phases.map((p) => ({ ...p, passed: isPassed(p.status) })),
        project.startDate,
        project.targetDate,
      );
  return {
    bac: Number(j.bac_cents ?? 0),
    baseline,
    actuals: ((j.actuals ?? []) as Row[]).map((a) => ({
      date: a.date,
      amountCents: Number(a.amount_cents),
    })),
  };
}

/** Passes the validated client IP to the audit trigger for this transaction only. */
async function withIp(tx: Tx, ip?: string) {
  await tx`select set_config('kh.client_ip', ${safeIp(ip) ?? ''}, true)`;
}

async function requireManager(tx: Tx, s: Session, key: string): Promise<Project> {
  const project = await findProject(tx, key);
  if (!canManageProject(s.user, project)) throw new ForbiddenError(FORBIDDEN);
  return project;
}

const toAudit = (r: Row): AuditEntry => ({
  id: String(r.id),
  actorId: r.actor_id ?? '',
  action: r.action,
  entity: r.entity,
  entityId: r.entity_id ?? '',
  before: r.before ?? undefined,
  after: r.after ?? undefined,
  ...(r.ip_text ? { ip: r.ip_text } : {}),
  at: r.at,
});

export function createPostgresInsightStore(sql: Sql): InsightStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  return {
    async getDashboard(s, key, now = new Date()) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        const [meta] = await tx`
          select p.share_budget, o.name as client_name from public.projects p
          left join public.organizations o on o.id = p.client_org_id where p.id = ${project.id}`;
        const [people, phaseRows, sprints, deliverables, raid, items] = await Promise.all([
          tx`select id, name from public.profiles`,
          tx`select * from public.phases where project_id = ${project.id} order by gate`,
          tx`select name, end_date from public.sprints where project_id = ${project.id} order by start_date`,
          tx`select id, name, status, due_date, visibility from public.deliverables
             where project_id = ${project.id} order by coalesce(due_date, '9999-12-31'), id`,
          tx`${RAID_SELECT(tx)} where r.project_id = ${project.id} order by r.created_at desc, r.id`,
          tx`select key, title, status, due_date from public.work_items
             where project_id = ${project.id} and deleted_at is null order by position, number`,
        ]);
        const phases = phaseRows.map(toPhase);
        const names = new Map(people.map((p) => [p.id as string, p.name as string]));
        return assembleDashboard(
          s,
          {
            project,
            clientName: meta?.client_name ?? '—',
            nameOf: (id) => (id && names.get(id)) || '—',
            shareBudget: Boolean(meta?.share_budget),
            evm: await evmInputs(tx, project, phases),
            phases,
            sprints: sprints.map((x) => ({ name: x.name, endDate: x.end_date })),
            deliverables: deliverables
              .map((d) => ({
                id: d.id,
                name: d.name,
                status: d.status,
                dueDate: d.due_date ?? null,
                visibility: d.visibility,
              }))
              // Drafts stay hidden from clients even when shared (RLS shows shared rows).
              .filter((d) => canSeeDeliverable(s.user, d as unknown as Deliverable)),
            raid: raid.map((r) => deriveRaid(toEntry(r), now)),
            items: items.map((i) => ({
              key: i.key,
              title: i.title,
              status: i.status,
              dueDate: i.due_date ?? null,
            })),
          },
          now,
        );
      });
    },

    async overrideRag(s, key, input, ip) {
      return run(s, async (tx) => {
        const project = await requireManager(tx, s, key);
        const err = ragOverrideError(input.reason);
        if (err) throw new ValidationError(err);
        await withIp(tx, ip);
        const [row] = await tx`
          update public.projects set rag = ${input.rag}, rag_reason = ${input.reason.trim()}
          where id = ${project.id} returning rag, rag_reason`;
        await logActivity(
          tx,
          s,
          project.id,
          'project.rag',
          `RAG status set to ${RAG_TEXT[input.rag]}`,
          'internal',
        );
        return { rag: row.rag, ragReason: row.rag_reason ?? undefined };
      });
    },

    async setShareBudget(s, key, shareBudget, ip) {
      return run(s, async (tx) => {
        const project = await requireManager(tx, s, key);
        await withIp(tx, ip);
        await tx`update public.projects set share_budget = ${shareBudget}
                 where id = ${project.id} and share_budget is distinct from ${shareBudget}`;
        return {
          projectId: project.id,
          shareBudget,
          updatedBy: s.user.id,
          updatedAt: new Date().toISOString(),
        };
      });
    },

    async recordDashboardExport(s, projectId, variant, ip) {
      await run(
        s,
        (tx) => tx`
          insert into public.audit_log (actor_id, project_id, action, entity, entity_id, after, ip)
          values (${s.user.id}, ${uuidOrNull(projectId)}, 'dashboard.export_pdf', 'project', ${projectId},
                  ${jsonb(tx, { variant })}::jsonb, ${safeIp(ip)}::inet)`,
      );
    },

    async listDashboardAudit(s, key) {
      return run(s, async (tx) => {
        const project = await requireManager(tx, s, key);
        // RLS: Admins read every audit row; the Lead reads these through audit_log_dashboard_select.
        const rows = await tx`
          select a.*, host(a.ip) as ip_text from public.audit_log a
          where a.entity = 'project' and a.entity_id = ${project.id}
            and (a.action like 'project.rag%' or a.action like 'dashboard.%')
          order by a.at desc, a.id desc`;
        return rows.map(toAudit);
      });
    },

    async getPortfolio(s, now = new Date()) {
      if (!canSeePortfolio(s.user))
        throw new ForbiddenError('The portfolio dashboard is for Konnector staff.');
      return run(s, async (tx) => {
        const asOf = isoDay(now);
        const money = canSeeFinancials(s.user);
        const projects = await tx`
          select p.id from public.projects p where p.deleted_at is null order by p.key`;
        const ids = textArray(projects.map((p) => p.id));
        const [orgs, people, phaseRows, raidRows] = await Promise.all([
          tx`select id, name from public.organizations`,
          tx`select id, name from public.profiles`,
          tx`select * from public.phases where project_id = any(${ids}::uuid[]) order by gate`,
          tx`${RAID_SELECT(tx)} where r.project_id = any(${ids}::uuid[])`,
        ]);
        const orgName = new Map(orgs.map((o) => [o.id as string, o.name as string]));
        const personName = new Map(people.map((p) => [p.id as string, p.name as string]));
        const rows = [];
        for (const { id } of projects) {
          const p = await findProject(tx, id);
          const phases = phaseRows.filter((r) => r.project_id === id).map(toPhase);
          rows.push(
            portfolioRow(p, {
              clientName: orgName.get(p.clientOrgId) ?? '—',
              leadName: personName.get(p.leadId) ?? '—',
              evm: evmFrom(await evmInputs(tx, p, phases), asOf),
              raid: raidRows.filter((r) => r.project_id === id).map((r) => deriveRaid(toEntry(r), now)),
              phases,
              money,
            }),
          );
        }
        return assemblePortfolio(rows, asOf, money);
      });
    },
  };
}

let store: InsightStore | undefined;
export const postgresInsightStore = (): InsightStore => (store ??= createPostgresInsightStore(getSql()));
