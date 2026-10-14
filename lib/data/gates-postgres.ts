import { isIP } from 'node:net';
import type { Phase, Project, Session } from '../domain/types';
import {
  buildSummary,
  canDecideGate,
  canEditCriteria,
  canManageGates,
  canRequestReview,
  checkExitCriteria,
  isReauthFresh,
  redactReview,
  validateDecision,
  type GatePack,
  type GateReview,
} from '../domain/gates';
import type { DecideContext, GateStore, PendingGateReview } from './gates';
import { ForbiddenError, NotFoundError, ReauthRequiredError, ValidationError } from './errors';
import {
  asUser,
  audit,
  findProject,
  getSql,
  opt,
  textArray,
  toCriterion,
  toPhase,
  uuidOr,
  type AsUserOptions,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { pgOnGateDecided, pgOnGateRequested } from './notify-postgres';

/**
 * Gates on Postgres + RLS (0005_gates_deliverables). Reviews are requested through
 * request_gate_review() and decided through decide_gate(); both are SECURITY DEFINER and
 * re-check every rule, so the app-level checks here only give the demo store's messages first.
 *
 * Re-auth: the route verifies the signed `kh_reauth` cookie (lib/reauth.ts) and passes its time
 * as `ctx.reauthAt`. When it is fresh, the decision transaction first records it with
 * record_reauth() (0009) as the server's own role, then switches to the user and calls the RPC,
 * whose has_fresh_reauth() check reads that row.
 */

/** A client IP only if it parses (X-Forwarded-For is user-controlled); otherwise none. */
export const safeIp = (ip: string | undefined) => (ip && isIP(ip) ? ip : null);

/** asUser options that record a verified, fresh re-auth before the transaction becomes the user. */
export function reauthOptions(s: Session, ctx: DecideContext): AsUserOptions {
  if (!isReauthFresh(ctx.reauthAt, ctx.now ?? new Date())) return {};
  return {
    privileged: (tx) => tx`select public.record_reauth(${s.user.id}::uuid, ${ctx.reauthAt}::timestamptz)`,
  };
}

export function requireFreshReauth(ctx: DecideContext) {
  if (!isReauthFresh(ctx.reauthAt, ctx.now ?? new Date())) throw new ReauthRequiredError();
}

function requireManager(s: Session, project: Project) {
  if (!canManageGates(s.user, project))
    throw new ForbiddenError('Only the project Lead or an Admin can manage gates.');
}

async function requirePhase(tx: Tx, project: Project, phaseId: string): Promise<Phase> {
  const [row] =
    await tx`select * from public.phases where id = ${uuidOr(phaseId)} and project_id = ${project.id}`;
  if (!row) throw new NotFoundError('Phase not found');
  return toPhase(row);
}

async function requireCriterion(tx: Tx, project: Project, id: string) {
  const [row] =
    await tx`select * from public.gate_criteria where id = ${uuidOr(id)} and project_id = ${project.id}`;
  if (!row) throw new NotFoundError('Criterion not found');
  return row;
}

function editable(phase: Phase) {
  const ok = canEditCriteria(phase);
  if (!ok.ok) throw new ValidationError(ok.reason);
}

/**
 * Reviews as GateReview. The stored pack holds the summary and the criteria snapshot; the
 * deliverables, open risks and budget are read live through RLS (deliverables, raid_entries,
 * gate_review_budgets), so a client never receives internal rows or an unshared budget.
 */
async function loadReviews(tx: Tx, s: Session, projectId: string, only?: string): Promise<GateReview[]> {
  const [rows, deliverables, risks] = await Promise.all([
    tx`select g.*, host(g.ip) as ip_text, ph.gate, b.bac, b.percent_complete, p.contract_type
       from public.gate_reviews g
       join public.phases ph on ph.id = g.phase_id
       join public.projects p on p.id = g.project_id
       left join public.gate_review_budgets b on b.review_id = g.id
       where g.project_id = ${projectId} ${only ? tx`and g.id = ${uuidOr(only)}` : tx``}
       order by coalesce(g.requested_at, g.decided_at), g.id`,
    tx`select id, phase_id, name, status, visibility from public.deliverables
       where project_id = ${projectId} order by created_at, id`,
    tx`select id, title, score, visibility from public.raid_entries
       where project_id = ${projectId} and kind = 'risk' and status <> 'closed'
       order by score desc, created_at`,
  ]);
  return rows.map((r: Row) => {
    const pack = (r.pack ?? {}) as Partial<GatePack>;
    const review: GateReview = {
      id: r.id,
      projectId: r.project_id,
      phaseId: r.phase_id,
      gate: r.gate,
      status: r.status,
      requestedBy: r.requested_by ?? r.decided_by ?? '',
      requestedAt: r.requested_at ?? r.decided_at,
      overrideNote: opt(r.override_note),
      budgetShared: r.budget_shared,
      pack: {
        summary: pack.summary ?? '',
        completedCriteria: (pack.completedCriteria ?? []).map((c) => ({
          id: c.id,
          text: c.text,
          doneBy: opt(c.doneBy),
          doneAt: opt(c.doneAt),
        })),
        overriddenCriteria: pack.overriddenCriteria ?? [],
        deliverables: deliverables
          .filter((d) => d.phase_id === r.phase_id)
          .map((d) => ({ id: d.id, name: d.name, status: d.status, visibility: d.visibility })),
        openRisks: risks.map((x) => ({ id: x.id, title: x.title, score: x.score, visibility: x.visibility })),
        budget:
          r.bac == null
            ? undefined
            : {
                bac: Number(r.bac),
                contractType: r.contract_type,
                percentComplete: Number(r.percent_complete),
              },
      },
      decision: opt(r.decision),
      conditions: r.conditions ? String(r.conditions).split('\n') : undefined,
      conditionItemKeys: r.condition_item_keys?.length ? r.condition_item_keys : undefined,
      reason: opt(r.reason),
      decidedBy: opt(r.decided_by),
      decidedAt: opt(r.decided_at),
      ip: opt(r.ip_text),
    };
    return redactReview(s.user, review);
  });
}

export function createPostgresGateStore(sql: Sql): GateStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>, opts?: AsUserOptions) =>
    asUser(sql, s.user.id, fn, opts);

  return {
    async getGates(s, key) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        const [phases, criteria] = await Promise.all([
          tx`select * from public.phases where project_id = ${project.id} order by gate`,
          tx`select c.* from public.gate_criteria c join public.phases ph on ph.id = c.phase_id
             where c.project_id = ${project.id} order by ph.gate, c.position, c.id`,
        ]);
        return {
          phases: phases.map(toPhase),
          criteria: criteria.map(toCriterion),
          reviews: await loadReviews(tx, s, project.id),
          canManage: canManageGates(s.user, project),
          canDecide: canDecideGate(s.user, project),
        };
      });
    },

    async addCriterion(s, key, phaseId, text) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        requireManager(s, project);
        editable(await requirePhase(tx, project, phaseId));
        if (!text.trim()) throw new ValidationError('Criterion text is required.');
        const [row] = await tx`
          insert into public.gate_criteria (project_id, phase_id, text, position)
          values (${project.id}, ${uuidOr(phaseId)}, ${text.trim()},
            (select coalesce(max(position), 0) + 1 from public.gate_criteria where phase_id = ${uuidOr(phaseId)}))
          returning *`;
        const c = toCriterion(row);
        await audit(tx, s, project.id, 'gate_criterion.create', 'gate_criterion', c.id, undefined, c);
        return c;
      });
    },

    async updateCriterion(s, key, criterionId, patch) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        requireManager(s, project);
        const before = await requireCriterion(tx, project, criterionId);
        editable(await requirePhase(tx, project, before.phase_id));
        const set: Row = {};
        if (patch.text !== undefined) {
          if (!patch.text.trim()) throw new ValidationError('Criterion text is required.');
          set.text = patch.text.trim();
        }
        if (patch.done !== undefined && patch.done !== before.done) {
          set.done = patch.done;
          set.done_by = patch.done ? s.user.id : null;
          set.done_at = patch.done ? new Date().toISOString() : null;
        }
        const [row] = Object.keys(set).length
          ? await tx`update public.gate_criteria set ${tx(set)} where id = ${before.id} returning *`
          : [before];
        const c = toCriterion(row);
        await audit(
          tx,
          s,
          project.id,
          'gate_criterion.update',
          'gate_criterion',
          c.id,
          toCriterion(before),
          c,
        );
        return c;
      });
    },

    async removeCriterion(s, key, criterionId) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        requireManager(s, project);
        const c = await requireCriterion(tx, project, criterionId);
        editable(await requirePhase(tx, project, c.phase_id));
        await tx`delete from public.gate_criteria where id = ${c.id}`;
        await audit(tx, s, project.id, 'gate_criterion.delete', 'gate_criterion', c.id, toCriterion(c));
        return { ok: true };
      });
    },

    async requestReview(s, key, input) {
      return run(s, async (tx) => {
        const project = await findProject(tx, key);
        requireManager(s, project);
        const phase = await requirePhase(tx, project, input.phaseId);
        const phases = (await tx`select * from public.phases where project_id = ${project.id}`).map(toPhase);
        const can = canRequestReview(phase, phases);
        if (!can.ok) throw new ValidationError(can.reason);
        const criteria = (await tx`select * from public.gate_criteria where phase_id = ${phase.id}`).map(
          toCriterion,
        );
        const check = checkExitCriteria(criteria, input.overrideNote);
        if (!check.ok) throw new ValidationError(check.reason);
        const [{ deliverables }] = await tx`
          select count(*)::int as deliverables from public.deliverables
          where project_id = ${project.id} and phase_id = ${phase.id}`;
        const [{ risks }] = await tx`
          select count(*)::int as risks from public.raid_entries
          where project_id = ${project.id} and kind = 'risk' and status <> 'closed'`;
        const summary =
          input.summary?.trim() ||
          buildSummary(phase, criteria.length - check.open.length, criteria.length, deliverables, risks);
        const [row] = await tx`
          select id from public.request_gate_review(${phase.id}::uuid, ${input.overrideNote ?? null}::text,
            ${summary}::text, ${Boolean(input.shareBudget)}::boolean)`;
        await pgOnGateRequested(tx, s, project, { id: row.id, gate: phase.gate, summary }, phase.name);
        return (await loadReviews(tx, s, project.id, row.id))[0];
      });
    },

    async listPendingReviews(s) {
      return run(s, async (tx) => {
        const rows = await tx`
          select g.id, g.project_id, p.key, p.name as project_name, p.client_org_id, p.deleted_at,
                 ph.name as phase_name
          from public.gate_reviews g
          join public.projects p on p.id = g.project_id
          join public.phases ph on ph.id = g.phase_id
          where g.status = 'pending'
          order by g.requested_at, g.id`;
        const out: PendingGateReview[] = [];
        for (const r of rows) {
          const project = { clientOrgId: r.client_org_id, deletedAt: r.deleted_at } as Project;
          if (!canDecideGate(s.user, project)) continue;
          const [review] = await loadReviews(tx, s, r.project_id, r.id);
          out.push({ review, projectKey: r.key, projectName: r.project_name, phaseName: r.phase_name });
        }
        return out;
      });
    },

    async decideGate(s, reviewId, input, ctx) {
      return run(
        s,
        async (tx) => {
          const [r] =
            await tx`select id, project_id, status from public.gate_reviews where id = ${uuidOr(reviewId)}`;
          if (!r) throw new NotFoundError('Gate review not found');
          const project = await findProject(tx, r.project_id);
          if (!canDecideGate(s.user, project))
            throw new ForbiddenError("Only the client's Sponsor can approve or reject a gate.");
          if (r.status !== 'pending') throw new ValidationError('This gate review has already been decided.');
          requireFreshReauth(ctx);
          const v = validateDecision(input);
          if (!v.ok) throw new ValidationError(v.reason);
          await tx`
            select 1 from public.decide_gate(${r.id}::uuid, ${v.value.decision}::public.gate_decision,
              ${v.value.conditions ? textArray(v.value.conditions) : null}::text[],
              ${v.value.reason ?? null}::text, ${safeIp(ctx.ip)}::inet)`;
          const [d] = await tx`
            select ph.gate, ph.name as phase_name, g.decision, g.reason, g.conditions, g.requested_by
            from public.gate_reviews g join public.phases ph on ph.id = g.phase_id where g.id = ${r.id}`;
          await pgOnGateDecided(
            tx,
            s,
            project,
            {
              gate: d.gate,
              decision: d.decision,
              reason: d.reason,
              conditions: d.conditions ? String(d.conditions).split('\n') : null,
              requestedBy: d.requested_by,
            },
            d.phase_name,
          );
          return (await loadReviews(tx, s, project.id, r.id))[0];
        },
        reauthOptions(s, ctx),
      );
    },
  };
}

let store: GateStore | undefined;
export const postgresGateStore = (): GateStore => (store ??= createPostgresGateStore(getSql()));
