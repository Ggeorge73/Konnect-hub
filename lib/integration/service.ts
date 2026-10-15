import { randomUUID } from 'node:crypto';
import type { Role, Session } from '../domain/types';
import {
  backoffMs,
  CLIENT_ITEM_TYPE_LABEL,
  deriveProjectKey,
  handoffDescription,
  isPermanentFailure,
  MAX_ATTEMPTS,
  PORTAL_ROLE_FOR,
  projectHealth,
  reminderDue,
  shouldSendHealth,
  type ClientItem,
  type DecisionInput,
  type IntegrationEvent,
  type SurveyInput,
} from '../domain/crm';
import { isReauthFresh } from '../domain/gates';
import { isClientRole } from '../domain/permissions';
import { getRepo, isPostgresEnabled } from '../data';
import { db } from '../data/memory';
import { getSql, loadSession } from '../data/postgres';
import { integrationStore } from '../data/integration';
import { createClientOrg } from '../data/onboarding';
import { adminStore } from '../data/admin';
import { getDashboard } from '../data/insight';
import { listDeliverables } from '../data/deliverables';
import { NotFoundError, ReauthRequiredError, ValidationError } from '../data/errors';
import { sendEmail } from '../email/send';
import { appUrl, notificationEmail } from '../email/templates';
import {
  CrmToHubEvent,
  findForbiddenKeys,
  HubToCrmEvent,
  inboundKey,
  outboundKey,
  type ClientItemPublishedPayload,
  type ClientItemWithdrawnPayload,
  type HandoffAck,
  type OpportunityWonPayload,
  type ProjectExtendedPayload,
} from './contract';
import { verify } from './signing';
import { crmTransport, integrationSecret } from './transport';

/**
 * The Konnector CRM integration (docs/integration.md). Every inbound call is verified, validated
 * against the strict contract, de-duplicated on its idempotency key and logged in
 * `integration_events`; every outbound event is logged first, then delivered with retries.
 */

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const store = () => integrationStore();

// ---------------------------------------------------------------------------
// The integration actor
// ---------------------------------------------------------------------------

/**
 * Who the Hub records as acting for the CRM (audit log, activity): the Admin profile named by
 * CRM_INTEGRATION_ACTOR_EMAIL (create a dedicated "Konnector CRM" Admin in production), else the
 * first active Admin.
 */
export async function actorSession(): Promise<Session> {
  const email = process.env.CRM_INTEGRATION_ACTOR_EMAIL;
  const named = email ? await store().findProfileByEmail(email) : null;
  const actor = named?.role === 'admin' ? named : await store().firstAdmin();
  if (!actor) throw new ValidationError('No active Admin to act for the CRM integration.');
  if (isPostgresEnabled()) {
    const s = await loadSession(getSql(), actor.id);
    if (!s) throw new ValidationError('The CRM integration actor could not be loaded.');
    return s;
  }
  const d = db();
  return { user: d.profiles.find((p) => p.id === actor.id)!, org: d.orgs.find((o) => o.id === actor.orgId)! };
}

// ---------------------------------------------------------------------------
// Inbound (CRM → Hub)
// ---------------------------------------------------------------------------

/** Verifies, validates, de-duplicates, logs and applies one CRM event. */
export async function receive(body: string, signature: string | null, now = new Date()): Promise<HttpResult> {
  let secret: string;
  try {
    secret = integrationSecret();
  } catch (e) {
    console.error(e);
    return { status: 401, body: { error: 'integration not configured' } };
  }
  const v = verify(body, signature, secret, now.getTime());
  if (!v.ok) return { status: 401, body: { error: v.reason } };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
  const name =
    typeof (json as { event?: unknown })?.event === 'string' ? (json as { event: string }).event : '?';
  const forbidden = findForbiddenKeys(json);
  if (forbidden.length)
    return reject(name, `payload contains fields outside the contract: ${forbidden.join(', ')}`);
  const parsed = CrmToHubEvent.safeParse(json);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return reject(name, i ? `${i.path.join('.') || 'payload'}: ${i.message}` : 'invalid event');
  }
  const e = parsed.data;
  const key = inboundKey(e);
  const dup = await store().findEvent('inbound', key);
  if (dup?.status === 'processed') return { status: 200, body: { ...dup.response, idempotent_replay: true } };
  const row =
    dup ??
    (await store().insertEvent({
      direction: 'inbound',
      event: e.event,
      idempotencyKey: key,
      status: 'pending',
      attempts: 0,
      lastError: null,
      payload: e as unknown as Record<string, unknown>,
      response: null,
      nextAttemptAt: null,
    }));
  return applyLogged(row, e);
}

/** A payload outside the contract is refused and logged without its content (it may hold cost data). */
async function reject(event: string, error: string): Promise<HttpResult> {
  await store().insertEvent({
    direction: 'inbound',
    event: event.slice(0, 80),
    idempotencyKey: `rejected:${randomUUID()}`,
    status: 'rejected',
    attempts: 1,
    lastError: error.slice(0, 500),
    payload: {},
    response: null,
    nextAttemptAt: null,
  });
  return { status: 422, body: { error } };
}

async function applyLogged(row: IntegrationEvent, e: CrmToHubEvent): Promise<HttpResult> {
  try {
    const out = await apply(e);
    await store().updateEvent(row.id, {
      status: 'processed',
      attempts: row.attempts + 1,
      response: out,
      lastError: null,
    });
    return { status: 200, body: out };
  } catch (err) {
    const msg = (err as Error).message;
    await store().updateEvent(row.id, { status: 'failed', attempts: row.attempts + 1, lastError: msg });
    // Not found / validation: the CRM must fix the payload (422). Anything else: retry later (500).
    const status = err instanceof NotFoundError || err instanceof ValidationError ? 422 : 500;
    if (status === 500) console.error(err);
    return { status, body: { error: status === 500 ? 'Konnect Hub could not process the event.' : msg } };
  }
}

async function apply(e: CrmToHubEvent): Promise<Record<string, unknown>> {
  switch (e.event) {
    case 'opportunity.won':
      return handoff(e);
    case 'project.extended':
      return extend(e);
    case 'client_item.published':
      return publish(e);
    case 'client_item.withdrawn':
      return withdraw(e);
  }
}

/** `opportunity.won`: client org (matched or created), project from the hybrid template, portal invites. */
async function handoff(p: OpportunityWonPayload): Promise<HandoffAck> {
  const actor = await actorSession();
  const lead = await store().findProfileByEmail(p.delivery_lead_email);
  if (!lead || (lead.role !== 'delivery_lead' && lead.role !== 'admin'))
    throw new ValidationError(
      `No Delivery Lead or Admin with email ${p.delivery_lead_email} in Konnect Hub.`,
    );

  // Client org: the id the Hub gave before, else the CRM account, else the name, else a new org.
  let org = p.account.konnect_hub_client_id
    ? await store().findClientOrg(p.account.konnect_hub_client_id)
    : null;
  if (p.account.konnect_hub_client_id && !org)
    throw new NotFoundError(`Unknown konnect_hub_client_id ${p.account.konnect_hub_client_id}.`);
  if (!org) {
    const byCrm = await store().findOrgByCrmId(p.account.crm_id);
    org = byCrm ? await store().findClientOrg(byCrm) : await store().findClientOrg(p.account.name);
  }
  if (!org) {
    const created = await createClientOrg(actor, { name: p.account.name, logoUrl: '' });
    org = { id: created.id, name: created.name };
  }
  await store().linkOrg(org.id, p.account.crm_id);

  // A retried handoff (e.g. invites failed after the project was created) reuses its project.
  const prior = (await store().listProjectLinks()).find((l) => l.handoffKey === p.idempotency_key);
  let project = prior ? await store().findProject(prior.projectId) : null;
  if (!project) {
    const key = deriveProjectKey(p.project.name, await store().projectKeys());
    const created = await getRepo().createProject(actor, {
      key,
      name: p.project.name,
      clientOrgId: org.id,
      leadId: lead.id,
      templateId: 'kdf-hybrid',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: p.project.value,
      startDate: p.project.start_date,
      targetDate: p.project.end_date,
      description: handoffDescription(p.project),
      restricted: false,
    });
    await store().insertProjectLink({
      projectId: created.id,
      crmAccountId: p.account.crm_id,
      contractNo: p.project.contract_no,
      value: p.project.value,
      currency: p.project.currency,
      serviceLines: p.project.service_lines,
      scopeSummary: p.project.scope_summary,
      acceptanceCriteria: p.project.acceptance_criteria,
      documents: p.documents,
      handoffKey: p.idempotency_key,
      createdAt: new Date().toISOString(),
    });
    project = { id: created.id, key: created.key, name: created.name, leadId: lead.id, clientOrgId: org.id };
  }

  // Portal invites, one batch per portal role (people already in or invited are skipped).
  const byRole = new Map<Role, string[]>();
  for (const c of p.client_contacts) {
    const role = PORTAL_ROLE_FOR[c.role];
    byRole.set(role, [...(byRole.get(role) ?? []), c.email]);
  }
  for (const [role, emails] of byRole)
    await adminStore().invite(actor, { emails: emails.join(', '), role, orgId: org.id });

  return {
    konnect_hub_client_id: org.id,
    konnect_hub_project_id: project.id,
    project_url: appUrl(`/projects/${project.key}`),
  };
}

/** `project.extended`: new end date and/or value, with a visible change entry on the project. */
async function extend(p: ProjectExtendedPayload) {
  const link = await store().getProjectLink(p.konnect_hub_project_id);
  if (!link) throw new NotFoundError(`Unknown konnect_hub_project_id ${p.konnect_hub_project_id}.`);
  if (p.additional_value && p.currency !== link.currency)
    throw new ValidationError(`Currency ${p.currency} does not match the contract (${link.currency}).`);
  const actor = await actorSession();
  const entry = await store().extendProject(
    link.projectId,
    {
      at: new Date().toISOString(),
      reason: p.reason,
      newEndDate: p.new_end_date,
      additionalValue: p.additional_value,
      currency: p.currency,
    },
    actor.user.id,
  );
  return { ok: true, change_entry: entry };
}

/** `client_item.published`: stored for the client's organization (and project) and announced. */
async function publish(p: ClientItemPublishedPayload) {
  const i = p.item;
  const org = await store().findClientOrg(i.konnect_hub_client_id);
  if (!org) throw new NotFoundError(`Unknown konnect_hub_client_id ${i.konnect_hub_client_id}.`);
  const project = i.konnect_hub_project_id ? await store().findProject(i.konnect_hub_project_id) : null;
  if (i.konnect_hub_project_id && (!project || project.clientOrgId !== org.id))
    throw new NotFoundError(`Unknown konnect_hub_project_id ${i.konnect_hub_project_id} for this client.`);
  const before = await store().getItemSystem(i.item_id);
  const item = await store().upsertItem({
    id: i.item_id,
    lineageId: i.lineage_id,
    version: i.version,
    supersedesVersion: i.supersedes_version,
    type: i.type,
    orgId: org.id,
    projectId: project?.id ?? null,
    title: i.title,
    summary: i.summary,
    amount: i.amount,
    currency: i.currency,
    lines: i.lines,
    terms: i.terms,
    newEndDate: i.new_end_date,
    respondBy: i.respond_by,
    document: i.document,
    requiresSignature: i.requires_signature,
    status: 'open',
    publishedAt: new Date().toISOString(),
    firstViewedAt: null,
    firstViewedBy: null,
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    decidedByTitle: null,
    decidedByEmail: null,
    decidedIp: null,
    decisionNote: null,
    surveyScore: null,
    surveyComment: null,
    withdrawnReason: null,
    remindedAt: null,
  });
  if (!before) await announce(item, `${CLIENT_ITEM_TYPE_LABEL[item.type]} for your review: ${item.title}`);
  return { ok: true, portal_url: appUrl(portalPath(item.id)) };
}

async function withdraw(p: ClientItemWithdrawnPayload) {
  const item = await store().withdrawItem(p.item_id, p.reason);
  if (!item) throw new NotFoundError(`Unknown item ${p.item_id}.`);
  return { ok: true };
}

export const portalPath = (id: string) => `/portal/review/${encodeURIComponent(id)}`;

/** Tells the client's approvers (and members, for surveys) about an item. */
async function announce(item: ClientItem, title: string, body?: string) {
  const roles =
    item.type === 'survey' ? (['client_sponsor', 'client_member'] as const) : (['client_sponsor'] as const);
  const people = await store().orgRecipients(item.orgId, [...roles]);
  const text =
    body ??
    [item.summary, item.respondBy ? `Please respond by ${item.respondBy}.` : null].filter(Boolean).join(' ');
  if (item.projectId) {
    await store().notify({
      kind: 'commercial_review',
      projectId: item.projectId,
      recipients: people.map((u) => u.id),
      title,
      body: text,
      href: portalPath(item.id),
      visibility: 'shared',
    });
    return;
  }
  // Account-level items have no project to hang an in-app notification on: email only.
  for (const u of people)
    await sendEmail(
      notificationEmail(u.email, { kind: 'commercial_review', title, body: text, href: portalPath(item.id) }),
    );
}

// ---------------------------------------------------------------------------
// Client actions in the portal (→ CRM)
// ---------------------------------------------------------------------------

/** Opens an item. The first open by a client user sends `client_item.viewed`. */
export async function openItem(s: Session, id: string, now = new Date()) {
  const { item, first } = await store().recordView(s, id, now.toISOString());
  if (first)
    await afterClientAction(() =>
      enqueue({
        event: 'client_item.viewed',
        item_id: item.id,
        version: item.version,
        viewed_by: { name: s.user.name, email: s.user.email },
        viewed_at: now.toISOString(),
      }),
    );
  return item;
}

/** Accept (needs a fresh re-auth, name and title), request changes (note) or decline. */
export async function decideItem(
  s: Session,
  id: string,
  input: DecisionInput,
  ctx: { ip: string | null; reauthAt: string | null },
  now = new Date(),
) {
  if (input.decision === 'accepted' && !isReauthFresh(ctx.reauthAt, now)) throw new ReauthRequiredError();
  const item = await store().decide(s, id, input, ctx.ip, now.toISOString());
  await afterClientAction(() =>
    enqueue({
      event: 'client_item.decided',
      item_id: item.id,
      version: item.version,
      decision: input.decision,
      note: item.decisionNote,
      decided_by: {
        name: item.decidedByName ?? s.user.name,
        title: item.decidedByTitle,
        email: s.user.email,
      },
      decided_at: item.decidedAt ?? now.toISOString(),
      ip: ctx.ip,
    }),
  );
  const verb = { accepted: 'accepted', declined: 'declined', changes_requested: 'asked for changes to' }[
    input.decision
  ];
  await afterClientAction(() =>
    tellLead(
      item,
      `${item.decidedByName ?? s.user.name} ${verb} “${item.title}”`,
      item.decisionNote ?? undefined,
    ),
  );
  return item;
}

export async function answerSurvey(s: Session, id: string, input: SurveyInput, now = new Date()) {
  const item = await store().answerSurvey(s, id, input, now.toISOString());
  await afterClientAction(() =>
    enqueue({
      event: 'survey.submitted',
      item_id: item.id,
      version: item.version,
      score: input.score,
      comment: item.surveyComment,
      submitted_by: { name: s.user.name, email: s.user.email },
      submitted_at: item.decidedAt ?? now.toISOString(),
    }),
  );
  await afterClientAction(() =>
    tellLead(
      item,
      `${s.user.name} answered “${item.title}”: ${input.score}/10`,
      item.surveyComment ?? undefined,
    ),
  );
  return item;
}

/** The project's Delivery Lead hears about every client decision. */
async function tellLead(item: ClientItem, title: string, body?: string) {
  if (!item.projectId) return;
  const project = await store().findProject(item.projectId);
  if (!project) return;
  await store().notify({
    kind: 'commercial_decided',
    projectId: project.id,
    recipients: [project.leadId],
    title,
    body,
    href: `/projects/${project.key}`,
    visibility: 'internal',
  });
}

export const listItems = (s: Session, projectKey?: string) => store().listItems(s, { projectKey });
export const getProjectCommercial = (s: Session, key: string) => store().getProjectCommercial(s, key);

/** Badge count for the portal: open items for this client user (optionally one project). */
export async function openCount(s: Session, projectKey?: string) {
  if (!isClientRole(s.user.role)) return 0;
  return (await store().listItems(s, { projectKey })).filter(
    (i) => i.status === 'open' || i.status === 'viewed',
  ).length;
}

// ---------------------------------------------------------------------------
// Outbound (Hub → CRM)
// ---------------------------------------------------------------------------

/**
 * After a client action is saved: log the CRM event and notify. A failure here must not tell the
 * client their decision failed (it is recorded); it is logged for the Admin instead.
 */
async function afterClientAction(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    console.error('CRM integration: follow-up after a client action failed', e);
  }
}

/** Logs an outbound event (once per idempotency key) and tries to deliver it right away. */
export async function enqueue(payload: HubToCrmEvent): Promise<IntegrationEvent> {
  const e = HubToCrmEvent.parse(payload);
  if (findForbiddenKeys(e).length) throw new Error('Outbound payload contains fields outside the contract.');
  const key = outboundKey(e);
  const existing = await store().findEvent('outbound', key);
  if (existing) return existing;
  const row = await store().insertEvent({
    direction: 'outbound',
    event: e.event,
    idempotencyKey: key,
    status: 'pending',
    attempts: 0,
    lastError: null,
    payload: e as unknown as Record<string, unknown>,
    response: null,
    nextAttemptAt: null,
  });
  return deliver(row);
}

/** One delivery attempt with the retry policy (1, 2, 4, 8, 16 min; 4xx fails fast). Never throws. */
export async function deliver(e: IntegrationEvent, now = new Date()): Promise<IntegrationEvent> {
  const attempts = e.attempts + 1;
  try {
    const res = await crmTransport()(e.event, JSON.stringify(e.payload));
    if (res.ok)
      return store().updateEvent(e.id, {
        status: 'processed',
        attempts,
        lastError: null,
        response: res.body,
        nextAttemptAt: null,
      });
    const error = `HTTP ${res.status}${typeof res.body.error === 'string' ? `: ${res.body.error}` : ''}`;
    return failed(e, attempts, error, isPermanentFailure(res.status), now);
  } catch (err) {
    return failed(e, attempts, (err as Error).message, false, now);
  }
}

function failed(e: IntegrationEvent, attempts: number, error: string, permanent: boolean, now: Date) {
  const dead = permanent || attempts >= MAX_ATTEMPTS;
  return store().updateEvent(e.id, {
    status: dead ? 'dead' : 'failed',
    attempts,
    lastError: error.slice(0, 500),
    nextAttemptAt: dead ? null : new Date(now.getTime() + backoffMs(attempts)).toISOString(),
  });
}

/** Admin "Retry": an outbound event is delivered again now; a failed inbound one is re-applied. */
export async function retryEvent(s: Session, id: string): Promise<IntegrationEvent> {
  if (s.user.role !== 'admin') throw new NotFoundError('Event not found');
  const e = await store().getEvent(id);
  if (!e) throw new NotFoundError('Event not found');
  if (e.status === 'processed') throw new ValidationError('This event was already processed.');
  if (e.direction === 'outbound') return deliver({ ...e, attempts: Math.min(e.attempts, MAX_ATTEMPTS - 1) });
  if (e.status === 'rejected')
    throw new ValidationError('Rejected payloads are not stored; ask the CRM to resend.');
  await applyLogged(e, CrmToHubEvent.parse(e.payload));
  return (await store().getEvent(id))!;
}

export const listEvents = (s: Session, limit?: number) => store().listEvents(s, limit);

// ---------------------------------------------------------------------------
// Health, reminders and the scheduled job
// ---------------------------------------------------------------------------

/**
 * Sends `project.health_updated` for every handed-off project whose health changed, and for every
 * one at least daily. The rules live in lib/domain/crm.ts (the Hub is the single source of truth).
 */
export async function syncHealth(now = new Date(), opts: { force?: boolean } = {}) {
  const actor = await actorSession();
  const asOf = now.toISOString().slice(0, 10);
  let sent = 0;
  for (const link of await store().listProjectLinks()) {
    const project = await store().findProject(link.projectId);
    if (!project) continue;
    const [dash, deliverables] = await Promise.all([
      getDashboard(actor, project.key, now),
      listDeliverables(actor, project.key),
    ]);
    const health = projectHealth({
      spi: dash.evm?.spi ?? null,
      cpi: dash.evm?.cpi ?? null,
      percentComplete: dash.evm?.percentComplete ?? 0,
      projectStatus: (await getRepo().getProjectBundle(actor, project.key)).project.status,
      deliverables: deliverables.map((d) => ({ status: d.status, dueDate: d.dueDate })),
      asOf,
    });
    if (!opts.force && !shouldSendHealth(link.lastHealth, link.lastHealthSentAt, health, now)) continue;
    await enqueue({
      version: '1',
      event: 'project.health_updated',
      konnect_hub_project_id: project.id,
      ...health,
      updated_at: now.toISOString(),
    });
    await store().saveHealth(project.id, health, now.toISOString());
    sent++;
  }
  return { sent };
}

/** "Respond by" reminders, 3 days before, once per item. */
export async function sendReminders(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  let reminded = 0;
  for (const item of await store().openItems()) {
    if (!reminderDue(item, today)) continue;
    await announce(
      item,
      `Reminder: ${CLIENT_ITEM_TYPE_LABEL[item.type].toLowerCase()} “${item.title}” needs a response by ${item.respondBy}`,
      'Konnector is waiting for your decision.',
    );
    await store().markReminded(item.id, now.toISOString());
    reminded++;
  }
  return { reminded };
}

/** Retries due deliveries (oldest first). */
export async function runDueDeliveries(now = new Date()) {
  const due = await store().dueOutbound(now);
  let delivered = 0;
  for (const e of due) if ((await deliver(e, now)).status === 'processed') delivered++;
  return { due: due.length, delivered };
}

/** The scheduled job (POST /api/integrations/crm/cron). */
export async function runCron(now = new Date()) {
  const deliveries = await runDueDeliveries(now);
  const health = await syncHealth(now);
  const reminders = await sendReminders(now);
  return { deliveries, health, reminders };
}
