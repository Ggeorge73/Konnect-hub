import type { Project, Session } from '../domain/types';
import { isClientRole } from '../domain/permissions';
import {
  canDecideCriterion,
  canDecideDeliverable,
  canEditDeliverables,
  canSeeDeliverable,
  canSubmit,
  type Deliverable,
} from '../domain/deliverables';
import type { DeliverableInput, DeliverableStore, DeliverableView } from './deliverables';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { reauthOptions, requireFreshReauth, safeIp } from './gates-postgres';
import {
  asUser,
  audit,
  findProject,
  getSql,
  logActivity,
  opt,
  textArray,
  uuidOr,
  uuidOrNull,
  type AsUserOptions,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { pgOnDeliverableSubmitted } from './notify-postgres';

/**
 * Deliverables on Postgres + RLS (deliverables, deliverable_items, deliverable_criteria).
 * Internal staff write the tables directly under RLS; clients decide criteria only through
 * decide_deliverable_criterion() (0005), which rolls the status up and, on a rejection,
 * reopens the linked items as a system action. Decisions record a fresh re-auth first
 * (see gates-postgres.ts).
 */

/** Deliverables matching `where`, as views; drafts stay hidden from clients (canSeeDeliverable). */
async function load(
  tx: Tx,
  s: Session,
  where: ReturnType<Tx>,
): Promise<(DeliverableView & { project: Project })[]> {
  const rows = await tx`
    select d.*, p.key as project_key, p.client_org_id, p.deleted_at as project_deleted_at
    from public.deliverables d join public.projects p on p.id = d.project_id
    where ${where}
    order by coalesce(d.due_date, '9999-12-31'), d.created_at, d.id`;
  if (!rows.length) return [];
  const ids = textArray(rows.map((r) => r.id));
  const [criteria, items] = await Promise.all([
    tx`select c.*, host(c.ip) as ip_text from public.deliverable_criteria c
       where c.deliverable_id = any(${ids}::uuid[]) order by c.position, c.id`,
    // RLS: a client never gets an internal item, even when it is linked.
    tx`select di.deliverable_id, w.id, w.key, w.title, w.status, w.visibility
       from public.deliverable_items di join public.work_items w on w.id = di.item_id
       where di.deliverable_id = any(${ids}::uuid[]) and w.deleted_at is null
       order by w.position, w.number`,
  ]);
  return rows
    .map((r: Row) => {
      const its = items
        .filter((i) => i.deliverable_id === r.id)
        .map((i) => ({ id: i.id, key: i.key, title: i.title, status: i.status, visibility: i.visibility }));
      const d: Deliverable = {
        id: r.id,
        projectId: r.project_id,
        phaseId: r.phase_id ?? null,
        name: r.name,
        description: r.description,
        ownerId: r.owner_id ?? '',
        dueDate: r.due_date ?? null,
        visibility: r.visibility,
        status: r.status,
        itemIds: its.map((i) => i.id),
        criteria: criteria
          .filter((c) => c.deliverable_id === r.id)
          .map((c) => ({
            id: c.id,
            text: c.text,
            status: c.status,
            decidedBy: opt(c.decided_by),
            decidedAt: opt(c.decided_at),
            note: opt(c.note),
            ip: opt(c.ip_text),
          })),
        createdBy: r.created_by ?? '',
        createdAt: r.created_at,
        submittedAt: opt(r.submitted_at),
        decidedAt: opt(r.decided_at),
      };
      const project = {
        id: r.project_id,
        clientOrgId: r.client_org_id,
        deletedAt: r.project_deleted_at,
      } as Project;
      return { ...d, projectKey: r.project_key, items: its, project };
    })
    .filter((d) => canSeeDeliverable(s.user, d));
}

const strip = ({ project: _p, ...view }: DeliverableView & { project: Project }): DeliverableView => view;

async function requireDeliverable(tx: Tx, s: Session, id: string) {
  const [d] = await load(tx, s, tx`d.id = ${uuidOr(id)}`);
  if (!d) throw new NotFoundError('Deliverable not found');
  return d;
}

async function view(tx: Tx, s: Session, id: string) {
  return strip(await requireDeliverable(tx, s, id));
}

async function validate(tx: Tx, projectId: string, input: Partial<DeliverableInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError('Name is required.');
  if (input.phaseId) {
    const [ok] =
      await tx`select 1 from public.phases where id = ${uuidOr(input.phaseId)} and project_id = ${projectId}`;
    if (!ok) throw new ValidationError('Unknown phase.');
  }
  if (input.ownerId !== undefined) {
    const [owner] = await tx`select role from public.profiles where id = ${uuidOr(input.ownerId)}`;
    if (!owner || isClientRole(owner.role))
      throw new ValidationError('Owner must be a Konnector team member.');
  }
  for (const id of input.itemIds ?? []) {
    const [ok] = await tx`
      select 1 from public.work_items
      where id = ${uuidOr(id)} and project_id = ${projectId} and deleted_at is null`;
    if (!ok) throw new ValidationError('Linked items must belong to this project.');
  }
}

async function saveItems(tx: Tx, projectId: string, deliverableId: string, itemIds: string[]) {
  await tx`delete from public.deliverable_items where deliverable_id = ${deliverableId}`;
  const ids = [...new Set(itemIds)];
  if (ids.length)
    await tx`insert into public.deliverable_items (project_id, deliverable_id, item_id)
             select ${projectId}, ${deliverableId}, unnest(${textArray(ids)}::uuid[])`;
}

const lines = (xs: string[]) => xs.map((t) => t.trim()).filter(Boolean);

export function createPostgresDeliverableStore(sql: Sql): DeliverableStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>, opts?: AsUserOptions) =>
    asUser(sql, s.user.id, fn, opts);

  return {
    async listDeliverables(s, key) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        return (await load(tx, s, tx`d.project_id = ${project.id}`)).map(strip);
      });
    },

    async listAwaitingAcceptance(s) {
      return run(s, async (tx) =>
        (await load(tx, s, tx`d.status = 'submitted'`))
          .filter((d) => canDecideDeliverable(s.user, d.project))
          .map(strip),
      );
    },

    async createDeliverable(s, key, input) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        if (!canEditDeliverables(s.user))
          throw new ForbiddenError('Only the Konnector team creates deliverables.');
        await validate(tx, project.id, input);
        const [row] = await tx`
          insert into public.deliverables ${tx({
            project_id: project.id,
            phase_id: uuidOrNull(input.phaseId),
            name: input.name.trim(),
            description: input.description?.trim() ?? '',
            owner_id: input.ownerId,
            due_date: input.dueDate || null,
            visibility: input.visibility,
            status: 'draft',
            created_by: s.user.id,
          })}
          returning id`;
        await saveItems(tx, project.id, row.id, input.itemIds);
        for (const [i, text] of lines(input.criteria).entries())
          await tx`insert into public.deliverable_criteria (project_id, deliverable_id, text, position)
                   values (${project.id}, ${row.id}, ${text}, ${i + 1})`;
        const d = await view(tx, s, row.id);
        // Project-level activity is visible to clients, so internal deliverables are only audited.
        if (d.visibility === 'shared')
          await logActivity(
            tx,
            s,
            project.id,
            'deliverable.created',
            `Deliverable "${d.name}" created`,
            'shared',
          );
        await audit(tx, s, project.id, 'deliverable.create', 'deliverable', d.id, undefined, d);
        return d;
      });
    },

    async updateDeliverable(s, id, patch) {
      return run(s, async (tx) => {
        const before = strip(await requireDeliverable(tx, s, id));
        if (!canEditDeliverables(s.user))
          throw new ForbiddenError('Only the Konnector team edits deliverables.');
        if (before.status === 'submitted' || before.status === 'accepted')
          throw new ValidationError('Deliverables awaiting or past acceptance cannot be edited.');
        await validate(tx, before.projectId, patch);
        const set: Row = {};
        if (patch.name !== undefined) set.name = patch.name.trim();
        if (patch.description !== undefined) set.description = patch.description.trim();
        if (patch.phaseId !== undefined) set.phase_id = uuidOrNull(patch.phaseId);
        if (patch.ownerId !== undefined) set.owner_id = patch.ownerId;
        if (patch.dueDate !== undefined) set.due_date = patch.dueDate || null;
        if (patch.visibility !== undefined) set.visibility = patch.visibility;
        if (Object.keys(set).length)
          await tx`update public.deliverables set ${tx(set)} where id = ${before.id}`;
        if (patch.itemIds !== undefined) await saveItems(tx, before.projectId, before.id, patch.itemIds);
        if (patch.criteria !== undefined) {
          // Unchanged texts keep their criterion (and decision); the rest are replaced.
          const texts = lines(patch.criteria);
          const keep = before.criteria.filter((c) => texts.includes(c.text));
          await tx`delete from public.deliverable_criteria
                   where deliverable_id = ${before.id} and not (id = any(${textArray(keep.map((c) => c.id))}::uuid[]))`;
          for (const [i, text] of texts.entries()) {
            const existing = keep.find((c) => c.text === text);
            if (existing)
              await tx`update public.deliverable_criteria set position = ${i + 1} where id = ${existing.id}`;
            else
              await tx`insert into public.deliverable_criteria (project_id, deliverable_id, text, position)
                       values (${before.projectId}, ${before.id}, ${text}, ${i + 1})`;
          }
        }
        const after = await view(tx, s, before.id);
        await audit(tx, s, before.projectId, 'deliverable.update', 'deliverable', before.id, before, after);
        return after;
      });
    },

    async submitDeliverable(s, id) {
      return run(s, async (tx) => {
        const d = strip(await requireDeliverable(tx, s, id));
        if (!canEditDeliverables(s.user))
          throw new ForbiddenError('Only the Konnector team submits deliverables.');
        const ok = canSubmit(d);
        if (!ok.ok) throw new ValidationError(ok.reason);
        await tx`update public.deliverable_criteria
                 set status = 'pending', decided_by = null, decided_at = null, note = null, ip = null
                 where deliverable_id = ${d.id}`;
        await tx`update public.deliverables
                 set status = 'submitted', submitted_at = now(), decided_at = null, decided_by = null
                 where id = ${d.id}`;
        await logActivity(
          tx,
          s,
          d.projectId,
          'deliverable.submitted',
          `Deliverable "${d.name}" submitted for client acceptance`,
          'shared',
        );
        await audit(tx, s, d.projectId, 'deliverable.submit', 'deliverable', d.id, d.status, 'submitted');
        await pgOnDeliverableSubmitted(tx, s, await findProject(tx, d.projectId), d);
        return view(tx, s, d.id);
      });
    },

    async decideCriterion(s, id, criterionId, input, ctx) {
      return run(
        s,
        async (tx) => {
          const d = await requireDeliverable(tx, s, id);
          const project = await findProject(tx, d.projectId);
          if (!canDecideDeliverable(s.user, project))
            throw new ForbiddenError("Only the client's Sponsor or Members can accept deliverables.");
          const ok = canDecideCriterion(d, criterionId);
          if (!ok.ok) throw new ValidationError(ok.reason);
          requireFreshReauth(ctx);
          await tx`
            select 1 from public.decide_deliverable_criterion(${uuidOr(criterionId)}::uuid,
              ${input.status}::public.ac_status, ${input.note?.trim() || null}::text, ${safeIp(ctx.ip)}::inet)`;
          return view(tx, s, d.id);
        },
        reauthOptions(s, ctx),
      );
    },
  };
}

let store: DeliverableStore | undefined;
export const postgresDeliverableStore = (): DeliverableStore =>
  (store ??= createPostgresDeliverableStore(getSql()));
