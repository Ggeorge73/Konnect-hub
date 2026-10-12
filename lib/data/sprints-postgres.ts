import type { Project, Session, Sprint } from '../domain/types';
import { canManageProject } from '../domain/permissions';
import { canStartSprint, planCompletion, validateSprint, type ItemSchedule } from '../domain/sprints';
import type { SprintPatch, SprintStore, TimelineData } from './sprints';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import {
  asUser,
  findProject,
  getSql,
  ITEM_COLS,
  logActivity,
  toItem,
  toPhase,
  toSprint,
  uuidOr,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Sprints, planning settings and the timeline on Postgres + RLS (0002_sprints_timeline):
 * `sprints_write` lets only the project's Lead or an Admin plan sprints, a partial unique index
 * allows one active sprint per project, `projects.hours_per_point` holds the capacity rate and
 * `work_items.planned_start/planned_end` the dragged epic dates. One transaction per call.
 */

async function requireProject(tx: Tx, keyOrId: string): Promise<Project> {
  const p = await findProject(tx, keyOrId);
  if (p.deletedAt) throw new NotFoundError('Project not found');
  return p;
}

function requireManager(s: Session, p: Project) {
  if (!canManageProject(s.user, p))
    throw new ForbiddenError('Only the project’s Delivery Lead or an Admin can manage sprints.');
}

async function requireSprint(tx: Tx, id: string): Promise<{ sprint: Sprint; project: Project }> {
  const [row] = await tx`select * from public.sprints where id = ${uuidOr(id)}`;
  if (!row) throw new NotFoundError('Sprint not found');
  return { sprint: toSprint(row), project: await requireProject(tx, row.project_id) };
}

async function requirePhaseOf(tx: Tx, projectId: string, phaseId: string) {
  const [ok] =
    await tx`select 1 from public.phases where id = ${uuidOr(phaseId)} and project_id = ${projectId}`;
  if (!ok) throw new ValidationError('Choose a phase of this project.');
}

const sprintsOf = async (tx: Tx, projectId: string) =>
  (await tx`select * from public.sprints where project_id = ${projectId} order by start_date, name`).map(
    toSprint,
  );

const fail = (errors: string[]) => {
  if (errors.length) throw new ValidationError(errors.join(' '));
};

// Project-level sprint events are shown to everyone on the project, as in the demo store.
const log = (tx: Tx, s: Session, projectId: string, action: string, detail: string) =>
  logActivity(tx, s, projectId, action, detail, 'shared');

async function updateSprintTx(tx: Tx, s: Session, id: string, patch: SprintPatch): Promise<Sprint> {
  const { sprint, project } = await requireSprint(tx, id);
  requireManager(s, project);
  const next = { ...sprint, ...patch };
  fail(validateSprint({ ...next, capacityHours: next.capacityHours ?? null }));
  if (patch.phaseId) await requirePhaseOf(tx, project.id, patch.phaseId);
  const set: Row = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.phaseId !== undefined) set.phase_id = uuidOr(patch.phaseId);
  if (patch.startDate !== undefined) set.start_date = patch.startDate;
  if (patch.endDate !== undefined) set.end_date = patch.endDate;
  if (patch.goal !== undefined) set.goal = patch.goal;
  if (patch.capacityHours !== undefined) set.capacity_hours = patch.capacityHours;
  const [row] = Object.keys(set).length
    ? await tx`update public.sprints set ${tx(set)} where id = ${sprint.id} returning *`
    : await tx`select * from public.sprints where id = ${sprint.id}`;
  const saved = toSprint(row);
  if (patch.startDate !== undefined || patch.endDate !== undefined)
    await log(
      tx,
      s,
      project.id,
      'sprint.rescheduled',
      `${saved.name} moved to ${saved.startDate} – ${saved.endDate}`,
    );
  else await log(tx, s, project.id, 'sprint.updated', `${saved.name} updated`);
  return saved;
}

export function createPostgresSprintStore(sql: Sql): SprintStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  return {
    async listSprints(s, projectKey) {
      return run(s, async (tx) => {
        const p = await requireProject(tx, projectKey);
        const [h] = await tx`select hours_per_point from public.projects where id = ${p.id}`;
        return {
          projectId: p.id,
          estimateUnit: p.estimateUnit,
          hoursPerPoint: Number(h.hours_per_point),
          canManage: canManageProject(s.user, p),
          sprints: await sprintsOf(tx, p.id),
        };
      });
    },

    async createSprint(s, input) {
      return run(s, async (tx) => {
        const p = await requireProject(tx, input.projectId);
        requireManager(s, p);
        fail(validateSprint(input));
        await requirePhaseOf(tx, p.id, input.phaseId);
        const [row] = await tx`
          insert into public.sprints ${tx({
            project_id: p.id,
            phase_id: input.phaseId,
            name: input.name.trim(),
            start_date: input.startDate,
            end_date: input.endDate,
            goal: input.goal?.trim() ?? '',
            status: 'planned',
            capacity_hours: input.capacityHours ?? null,
          })}
          returning *`;
        const sprint = toSprint(row);
        await log(
          tx,
          s,
          p.id,
          'sprint.created',
          `${sprint.name} planned (${sprint.startDate} to ${sprint.endDate})`,
        );
        return sprint;
      });
    },

    async updateSprint(s, id, patch) {
      return run(s, (tx) => updateSprintTx(tx, s, id, patch));
    },

    async startSprint(s, id) {
      return run(s, async (tx) => {
        const { sprint, project } = await requireSprint(tx, id);
        requireManager(s, project);
        // Friendly message first; the partial unique index sprints_one_active_per_project is the guard.
        const rule = canStartSprint(sprint, await sprintsOf(tx, project.id));
        if (!rule.ok) throw new ValidationError(rule.reason);
        const [row] =
          await tx`update public.sprints set status = 'active' where id = ${sprint.id} returning *`;
        await log(tx, s, project.id, 'sprint.started', `${sprint.name} started`);
        return toSprint(row);
      });
    },

    async completeSprint(s, id, carryOver) {
      return run(s, async (tx) => {
        const { sprint, project } = await requireSprint(tx, id);
        requireManager(s, project);
        const all = await sprintsOf(tx, project.id);
        const items = (
          await tx`select ${ITEM_COLS(tx)} from public.work_items w where w.project_id = ${project.id}`
        ).map((r) => toItem(r));
        const plan = planCompletion(sprint, all, items, carryOver);
        if ('error' in plan) throw new ValidationError(plan.error);
        for (const m of plan.moves)
          await tx`update public.work_items set sprint_id = ${m.sprintId}, position = ${m.position}
                   where id = ${m.itemId}`;
        const [row] =
          await tx`update public.sprints set status = 'completed' where id = ${sprint.id} returning *`;
        const target = plan.targetSprintId
          ? all.find((x) => x.id === plan.targetSprintId)!.name
          : 'the backlog';
        const n = plan.moves.length;
        await log(
          tx,
          s,
          project.id,
          'sprint.completed',
          n
            ? `${sprint.name} completed; ${n} unfinished item${n === 1 ? '' : 's'} moved to ${target}`
            : `${sprint.name} completed with all work finished`,
        );
        return {
          sprint: toSprint(row),
          moved: plan.unfinished.map((i) => i.key),
          targetSprintId: plan.targetSprintId,
        };
      });
    },

    async setHoursPerPoint(s, projectKey, hoursPerPoint) {
      return run(s, async (tx) => {
        const p = await requireProject(tx, projectKey);
        requireManager(s, p);
        if (!(hoursPerPoint > 0 && hoursPerPoint <= 100))
          throw new ValidationError('Hours per point must be between 0 and 100.');
        await tx`update public.projects set hours_per_point = ${hoursPerPoint} where id = ${p.id}`;
        await logActivity(
          tx,
          s,
          p.id,
          'planning.updated',
          `Capacity conversion set to ${hoursPerPoint} h per point`,
          'internal',
        );
        return { projectId: p.id, hoursPerPoint };
      });
    },

    async getTimeline(s, projectKey): Promise<TimelineData> {
      return run(s, async (tx) => {
        const p = await requireProject(tx, projectKey);
        const [phases, sprints, items, links] = await Promise.all([
          tx`select * from public.phases where project_id = ${p.id} order by gate`,
          tx`select * from public.sprints where project_id = ${p.id} order by start_date, name`,
          // RLS hides internal items from clients; links need both ends visible (item_links_select).
          tx`select id, key, title, type, status, parent_id, sprint_id, phase_id, due_date,
                    planned_start, planned_end
             from public.work_items
             where project_id = ${p.id} and deleted_at is null
             order by position, number`,
          tx`select id, from_id, to_id, type from public.item_links
             where project_id = ${p.id} and type = 'blocks'`,
        ]);
        const ids = new Set(items.map((i) => i.id as string));
        return {
          project: { id: p.id, key: p.key, name: p.name, startDate: p.startDate, targetDate: p.targetDate },
          phases: phases.map(toPhase),
          sprints: sprints.map(toSprint),
          items: items.map((i) => ({
            id: i.id,
            key: i.key,
            title: i.title,
            type: i.type,
            status: i.status,
            parentId: i.parent_id ?? null,
            sprintId: i.sprint_id ?? null,
            phaseId: i.phase_id ?? null,
            dueDate: i.due_date ?? null,
          })),
          links: links
            .filter((l) => ids.has(l.from_id) && ids.has(l.to_id))
            .map((l) => ({ id: l.id, fromId: l.from_id, toId: l.to_id, type: l.type })),
          schedules: items
            .filter((i) => i.planned_start && i.planned_end)
            .map((i): ItemSchedule => ({
              itemId: i.id,
              projectId: p.id,
              startDate: i.planned_start,
              endDate: i.planned_end,
            })),
          canEdit: canManageProject(s.user, p),
        };
      });
    },

    async reschedule(s, projectKey, input) {
      return run(s, async (tx) => {
        const p = await requireProject(tx, projectKey);
        requireManager(s, p);
        if (input.kind === 'sprint') {
          const [sp] =
            await tx`select id from public.sprints where id = ${uuidOr(input.id)} and project_id = ${p.id}`;
          if (!sp) throw new NotFoundError('Sprint not found');
          return updateSprintTx(tx, s, sp.id, { startDate: input.startDate, endDate: input.endDate });
        }
        const [epic] = await tx`
          select id, key, type, visibility from public.work_items
          where id = ${uuidOr(input.id)} and project_id = ${p.id} and deleted_at is null`;
        if (!epic || epic.type !== 'epic') throw new NotFoundError('Epic not found');
        if (input.endDate < input.startDate)
          throw new ValidationError('End date must not be before the start date.');
        await tx`update public.work_items set planned_start = ${input.startDate}, planned_end = ${input.endDate}
                 where id = ${epic.id}`;
        await logActivity(
          tx,
          s,
          p.id,
          'epic.rescheduled',
          `${epic.key} scheduled ${input.startDate} – ${input.endDate}`,
          epic.visibility,
          epic.id,
        );
        return { itemId: epic.id, projectId: p.id, startDate: input.startDate, endDate: input.endDate };
      });
    },
  };
}

let store: SprintStore | undefined;
export const postgresSprintStore = (): SprintStore => (store ??= createPostgresSprintStore(getSql()));
