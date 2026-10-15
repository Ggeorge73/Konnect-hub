import type { Profile, Role } from '../domain/types';
import type { ClientItem, CrmChangeEntry, CrmProjectLink, IntegrationEvent } from '../domain/crm';
import { canSeeFinancials, isClientRole } from '../domain/permissions';
import type { IntegrationStore } from './integration';
import { canSeeCommercial, extensionText } from './integration';
import {
  asService,
  asUser,
  getSql,
  isUuid,
  jsonParam,
  textArray,
  toProfile,
  uuidOr,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { pgNotify } from './notify-postgres';

/**
 * The integration store on Postgres (0018_crm_integration.sql). System methods run as
 * `service_role` (no user: the CRM's signature was verified by lib/integration/service.ts);
 * session methods run as the user, so RLS decides what exists and the SECURITY DEFINER
 * functions decide who may act on a commercial item.
 */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const day = (v: unknown) =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const num = (v: unknown) => (v == null ? null : Number(v));

const toEvent = (r: Row): IntegrationEvent => ({
  id: r.id,
  direction: r.direction,
  event: r.event,
  idempotencyKey: r.idempotency_key,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  payload: r.payload ?? {},
  response: r.response ?? null,
  nextAttemptAt: iso(r.next_attempt_at),
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const toLink = (r: Row): CrmProjectLink => ({
  projectId: r.project_id,
  crmAccountId: r.crm_account_id,
  contractNo: r.contract_no,
  value: Number(r.value),
  currency: String(r.currency).trim(),
  serviceLines: r.service_lines ?? [],
  scopeSummary: r.scope_summary,
  acceptanceCriteria: r.acceptance_criteria ?? [],
  documents: r.documents ?? [],
  handoffKey: r.handoff_key,
  createdAt: iso(r.created_at)!,
  lastHealth: r.last_health ?? null,
  lastHealthSentAt: iso(r.last_health_sent_at),
  changes: r.changes ?? [],
});

const toItem = (r: Row): ClientItem => ({
  id: r.id,
  lineageId: r.lineage_id,
  version: r.version,
  supersedesVersion: r.supersedes_version ?? null,
  type: r.type,
  orgId: r.org_id,
  projectId: r.project_id ?? null,
  title: r.title,
  summary: r.summary ?? null,
  amount: num(r.amount),
  currency: String(r.currency).trim(),
  lines: r.lines ?? [],
  terms: r.terms ?? null,
  newEndDate: day(r.new_end_date),
  respondBy: day(r.respond_by),
  document: r.document ?? null,
  requiresSignature: r.requires_signature,
  status: r.status,
  publishedAt: iso(r.published_at)!,
  firstViewedAt: iso(r.first_viewed_at),
  firstViewedBy: r.first_viewed_by ?? null,
  decidedAt: iso(r.decided_at),
  decidedById: r.decided_by ?? null,
  decidedByName: r.decided_by_name ?? null,
  decidedByTitle: r.decided_by_title ?? null,
  decidedByEmail: r.decided_by_email ?? null,
  decidedIp: r.decided_ip ?? null,
  decisionNote: r.decision_note ?? null,
  surveyScore: r.survey_score ?? null,
  surveyComment: r.survey_comment ?? null,
  withdrawnReason: r.withdrawn_reason ?? null,
  remindedAt: iso(r.reminded_at),
});

async function projectByKey(tx: Tx, key: string) {
  const [p] = await tx`select id, key from public.projects
                       where (key = ${key} or id = ${uuidOr(key)}) and deleted_at is null`;
  if (!p) throw new NotFoundError('Project not found');
  return p as { id: string; key: string };
}

async function itemAsUser(tx: Tx, id: string): Promise<ClientItem> {
  const [r] = await tx`select * from public.client_items where id = ${id}`;
  if (!r) throw new NotFoundError('Item not found');
  return toItem(r);
}

export function createPostgresIntegrationStore(sql: Sql): IntegrationStore {
  const svc = <T>(fn: (tx: Tx) => Promise<T>) => asService(sql, fn);

  const store: IntegrationStore = {
    async findEvent(direction, key) {
      return svc(async (tx) => {
        const [r] = await tx`select * from public.integration_events
                             where direction = ${direction} and idempotency_key = ${key}`;
        return r ? toEvent(r) : null;
      });
    },
    async insertEvent(e) {
      return svc(async (tx) => {
        const [r] = await tx`
          insert into public.integration_events
            (direction, event, idempotency_key, status, attempts, last_error, payload, response, next_attempt_at)
          values (${e.direction}, ${e.event}, ${e.idempotencyKey}, ${e.status}, ${e.attempts}, ${e.lastError},
                  ${jsonParam(tx, e.payload)}::jsonb, ${jsonParam(tx, e.response)}::jsonb, ${e.nextAttemptAt})
          returning *`;
        return toEvent(r);
      });
    },
    async updateEvent(id, patch) {
      return svc(async (tx) => {
        const [cur] = await tx`select * from public.integration_events where id = ${uuidOr(id)}`;
        if (!cur) throw new NotFoundError('Event not found');
        const e = { ...toEvent(cur), ...patch };
        const [r] = await tx`
          update public.integration_events
          set status = ${e.status}, attempts = ${e.attempts}, last_error = ${e.lastError},
              response = ${jsonParam(tx, e.response)}::jsonb, next_attempt_at = ${e.nextAttemptAt},
              updated_at = now()
          where id = ${cur.id} returning *`;
        return toEvent(r);
      });
    },
    async getEvent(id) {
      if (!isUuid(id)) return null;
      return svc(async (tx) => {
        const [r] = await tx`select * from public.integration_events where id = ${id}`;
        return r ? toEvent(r) : null;
      });
    },
    async dueOutbound(at) {
      return svc(async (tx) =>
        (
          await tx`select * from public.integration_events
                   where direction = 'outbound' and status in ('pending', 'failed')
                     and (next_attempt_at is null or next_attempt_at <= ${at.toISOString()})
                   order by created_at limit 200`
        ).map(toEvent),
      );
    },
    async listEvents(s, limit = 100) {
      if (s.user.role !== 'admin') throw new ForbiddenError('Only Admins can see integration events.');
      return asUser(sql, s.user.id, async (tx) =>
        (
          await tx`select * from public.integration_events order by created_at desc, id desc limit ${limit}`
        ).map(toEvent),
      );
    },

    async findProfileByEmail(email) {
      return svc(async (tx) => {
        const [r] = await tx`select * from public.profiles
                             where lower(email) = lower(${email}) and deactivated_at is null`;
        return r ? toProfile(r) : null;
      });
    },
    async firstAdmin() {
      return svc(async (tx) => {
        const [r] = await tx`select * from public.profiles where role = 'admin' and deactivated_at is null
                             order by created_at nulls last, email limit 1`;
        return r ? (toProfile(r) as Profile) : null;
      });
    },
    async findOrgByCrmId(crmId) {
      return svc(async (tx) => {
        const [r] = await tx`select org_id from public.crm_accounts where crm_account_id = ${crmId}`;
        return r?.org_id ?? null;
      });
    },
    async findClientOrg(idOrName) {
      return svc(async (tx) => {
        const [r] = await tx`select id, name from public.organizations
                             where type = 'client' and (id = ${uuidOr(idOrName)} or lower(name) = lower(${idOrName}))
                             order by (id = ${uuidOr(idOrName)}) desc limit 1`;
        return r ? { id: r.id, name: r.name } : null;
      });
    },
    async linkOrg(orgId, crmId) {
      await svc(
        (tx) => tx`insert into public.crm_accounts (org_id, crm_account_id) values (${orgId}, ${crmId})
                   on conflict do nothing`,
      );
    },
    async projectKeys() {
      return svc(async (tx) => (await tx`select key from public.projects`).map((r) => r.key as string));
    },
    async findProject(id) {
      return svc(async (tx) => {
        const [r] = await tx`select id, key, name, lead_id, client_org_id from public.projects
                             where (id = ${uuidOr(id)} or key = ${id}) and deleted_at is null`;
        return r
          ? { id: r.id, key: r.key, name: r.name, leadId: r.lead_id, clientOrgId: r.client_org_id }
          : null;
      });
    },
    async orgRecipients(orgId, roles) {
      if (!isUuid(orgId)) return [];
      return svc(async (tx) =>
        (
          await tx`select id, name, email, role from public.profiles
                   where org_id = ${orgId} and role::text = any(${textArray(roles)}::text[])
                     and deactivated_at is null order by name`
        ).map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role as Role })),
      );
    },

    async insertProjectLink(l) {
      await svc(
        (tx) => tx`
          insert into public.crm_projects
            (project_id, crm_account_id, contract_no, value, currency, service_lines, scope_summary,
             acceptance_criteria, documents, handoff_key, created_at)
          values (${l.projectId}, ${l.crmAccountId}, ${l.contractNo}, ${l.value}, ${l.currency},
                  ${textArray(l.serviceLines)}::text[], ${l.scopeSummary}, ${textArray(l.acceptanceCriteria)}::text[],
                  ${jsonParam(tx, l.documents)}::jsonb, ${l.handoffKey}, ${l.createdAt})`,
      );
    },
    async getProjectLink(projectId) {
      if (!isUuid(projectId)) return null;
      return svc(async (tx) => {
        const [r] = await tx`select * from public.crm_projects where project_id = ${projectId}`;
        return r ? toLink(r) : null;
      });
    },
    async listProjectLinks() {
      return svc(async (tx) =>
        (
          await tx`select c.* from public.crm_projects c
                   join public.projects p on p.id = c.project_id and p.deleted_at is null`
        ).map(toLink),
      );
    },
    async saveHealth(projectId, h, at) {
      await svc(
        (tx) => tx`update public.crm_projects
                   set last_health = ${jsonParam(tx, h)}::jsonb, last_health_sent_at = ${at}
                   where project_id = ${projectId}`,
      );
    },
    async extendProject(projectId, change, actorId) {
      return svc(async (tx) => {
        const [p] = await tx`select p.id, p.target_date, f.bac from public.projects p
                             left join public.project_financials f on f.project_id = p.id
                             where p.id = ${uuidOr(projectId)} and p.deleted_at is null for update of p`;
        const [l] = p ? await tx`select project_id from public.crm_projects where project_id = ${p.id}` : [];
        if (!p || !l) throw new NotFoundError('Project not found');
        const entry: CrmChangeEntry = { ...change, previousEndDate: day(p.target_date)! };
        const [after] = await tx`
          update public.projects set target_date = coalesce(${change.newEndDate}::date, target_date)
          where id = ${p.id} returning target_date`;
        const [fin] = await tx`
          insert into public.project_financials (project_id, bac) values (${p.id}, ${change.additionalValue ?? 0})
          on conflict (project_id) do update set bac = project_financials.bac + excluded.bac
          returning bac`;
        await tx`update public.crm_projects
                 set value = value + ${change.additionalValue ?? 0},
                     changes = changes || ${jsonParam(tx, [entry])}::jsonb
                 where project_id = ${p.id}`;
        await tx`insert into public.activity (project_id, actor_id, action, detail, visibility)
                 values (${p.id}, ${actorId}, 'project.extended', ${extensionText(entry)}, 'internal')`;
        await tx`insert into public.audit_log (actor_id, project_id, action, entity, entity_id, before, after)
                 values (${actorId}, ${p.id}, 'crm.project_extended', 'project', ${p.id},
                         ${jsonParam(tx, { targetDate: day(p.target_date), bac: Number(p.bac ?? 0) })}::jsonb,
                         ${jsonParam(tx, { targetDate: day(after.target_date), bac: Number(fin.bac), reason: change.reason })}::jsonb)`;
        return entry;
      });
    },

    async upsertItem(i) {
      return svc(async (tx) => {
        const [existing] = await tx`select * from public.client_items where id = ${i.id}`;
        if (existing) return toItem(existing);
        await tx`update public.client_items set status = 'superseded'
                 where lineage_id = ${i.lineageId} and version < ${i.version} and status in ('open', 'viewed')`;
        const [r] = await tx`
          insert into public.client_items
            (id, lineage_id, version, supersedes_version, type, org_id, project_id, title, summary, amount,
             currency, lines, terms, new_end_date, respond_by, document, requires_signature, status, published_at)
          values (${i.id}, ${i.lineageId}, ${i.version}, ${i.supersedesVersion}, ${i.type}, ${i.orgId},
                  ${i.projectId}, ${i.title}, ${i.summary}, ${i.amount}, ${i.currency},
                  ${jsonParam(tx, i.lines)}::jsonb, ${i.terms}, ${i.newEndDate}, ${i.respondBy},
                  ${jsonParam(tx, i.document)}::jsonb, ${i.requiresSignature}, ${i.status}, ${i.publishedAt})
          returning *`;
        return toItem(r);
      });
    },
    async withdrawItem(id, reason) {
      return svc(async (tx) => {
        const [r] = await tx`
          update public.client_items
          set status = 'withdrawn',
              withdrawn_reason = case when status = 'withdrawn' then withdrawn_reason else ${reason} end
          where id = ${id} returning *`;
        return r ? toItem(r) : null;
      });
    },
    async getItemSystem(id) {
      return svc(async (tx) => {
        const [r] = await tx`select * from public.client_items where id = ${id}`;
        return r ? toItem(r) : null;
      });
    },
    async openItems() {
      return svc(async (tx) =>
        (await tx`select * from public.client_items where status in ('open', 'viewed')`).map(toItem),
      );
    },
    async markReminded(id, at) {
      await svc((tx) => tx`update public.client_items set reminded_at = ${at} where id = ${id}`);
    },
    async notify(e) {
      await svc((tx) => pgNotify(tx, e));
    },

    async listItems(s, opts = {}) {
      return asUser(sql, s.user.id, async (tx) => {
        if (opts.projectKey) {
          const p = await projectByKey(tx, opts.projectKey);
          const rows = await tx`select * from public.client_items where project_id = ${p.id}
                                order by published_at desc`;
          return rows.map(toItem).filter((i) => i.status !== 'superseded' || !isClientRole(s.user.role));
        }
        if (!isClientRole(s.user.role)) throw new ValidationError('Pick a project.');
        return (
          await tx`select * from public.client_items where status <> 'superseded' order by published_at desc`
        ).map(toItem);
      });
    },
    async getItem(s, id) {
      return asUser(sql, s.user.id, (tx) => itemAsUser(tx, id));
    },
    async recordView(s, id) {
      return asUser(sql, s.user.id, async (tx) => {
        await itemAsUser(tx, id);
        if (!isClientRole(s.user.role)) return { item: await itemAsUser(tx, id), first: false };
        const [r] = await tx`select public.client_item_record_view(${id}) as first`;
        return { item: await itemAsUser(tx, id), first: Boolean(r.first) };
      });
    },
    async decide(s, id, input, ip) {
      return asUser(sql, s.user.id, async (tx) => {
        await itemAsUser(tx, id);
        await tx`select public.client_item_decide(${id}, ${input.decision}, ${input.note ?? null},
                   ${input.name ?? null}, ${input.title ?? null}, ${ip})`;
        return itemAsUser(tx, id);
      });
    },
    async answerSurvey(s, id, input) {
      return asUser(sql, s.user.id, async (tx) => {
        await itemAsUser(tx, id);
        await tx`select public.client_item_answer_survey(${id}, ${input.score}, ${input.comment ?? null})`;
        return itemAsUser(tx, id);
      });
    },
    async getProjectCommercial(s, key) {
      if (!canSeeCommercial(s)) throw new ForbiddenError('Commercial items are not available to your role.');
      return asUser(sql, s.user.id, async (tx) => {
        const p = await projectByKey(tx, key);
        const [l] = canSeeFinancials(s.user)
          ? await tx`select * from public.crm_projects where project_id = ${p.id}`
          : [];
        const items = await tx`select * from public.client_items where project_id = ${p.id}
                               order by published_at desc`;
        return { link: l ? toLink(l) : null, items: items.map(toItem) };
      });
    },
  };
  return store;
}

let store: IntegrationStore | undefined;
export const postgresIntegrationStore = (): IntegrationStore =>
  (store ??= createPostgresIntegrationStore(getSql()));
