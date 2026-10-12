import type { ItemLink, Phase, Project, Session, Sprint, WorkItem } from '../domain/types';
import { canManageProject, canSeeProject, canSeeVisibility } from '../domain/permissions';
import {
  canStartSprint,
  DEFAULT_HOURS_PER_POINT,
  planCompletion,
  validateSprint,
  type CarryOver,
  type ItemSchedule,
  type SprintInput,
} from '../domain/sprints';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';

const now = () => new Date().toISOString();

function requireProject(s: Session, keyOrId: string): Project {
  const d = db();
  const p = d.projects.find(
    (x) => (x.id === keyOrId || x.key === keyOrId) && !x.deletedAt && canSeeProject(s.user, x, d.members),
  );
  if (!p) throw new NotFoundError('Project not found');
  return p;
}

function requireManager(s: Session, p: Project) {
  if (!canManageProject(s.user, p))
    throw new ForbiddenError('Only the project’s Delivery Lead or an Admin can manage sprints.');
}

function requireSprint(s: Session, id: string): { sprint: Sprint; project: Project } {
  const sprint = db().sprints.find((x) => x.id === id);
  if (!sprint) throw new NotFoundError('Sprint not found');
  return { sprint, project: requireProject(s, sprint.projectId) };
}

function log(s: Session, projectId: string, action: string, detail: string) {
  db().activity.push({ id: newId('ac'), projectId, actorId: s.user.id, action, detail, at: now() });
}

const fail = (errors: string[]) => {
  if (errors.length) throw new ValidationError(errors.join(' '));
};

export function hoursPerPointFor(projectId: string): number {
  return (
    db().planning.settings.find((x) => x.projectId === projectId)?.hoursPerPoint ?? DEFAULT_HOURS_PER_POINT
  );
}

export interface SprintList {
  projectId: string;
  estimateUnit: Project['estimateUnit'];
  hoursPerPoint: number;
  canManage: boolean;
  sprints: Sprint[];
}

export function listSprints(s: Session, projectKey: string): SprintList {
  const p = requireProject(s, projectKey);
  return {
    projectId: p.id,
    estimateUnit: p.estimateUnit,
    hoursPerPoint: hoursPerPointFor(p.id),
    canManage: canManageProject(s.user, p),
    sprints: db()
      .sprints.filter((x) => x.projectId === p.id)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name)),
  };
}

export function createSprint(s: Session, input: SprintInput & { projectId: string }): Sprint {
  const p = requireProject(s, input.projectId);
  requireManager(s, p);
  fail(validateSprint(input));
  const d = db();
  if (!d.phases.some((ph) => ph.id === input.phaseId && ph.projectId === p.id))
    throw new ValidationError('Choose a phase of this project.');
  const sprint: Sprint = {
    id: newId('s'),
    projectId: p.id,
    phaseId: input.phaseId,
    name: input.name.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    goal: input.goal?.trim() ?? '',
    status: 'planned',
    capacityHours: input.capacityHours ?? undefined,
  };
  d.sprints.push(sprint);
  log(s, p.id, 'sprint.created', `${sprint.name} planned (${sprint.startDate} to ${sprint.endDate})`);
  return sprint;
}

export type SprintPatch = Partial<Omit<SprintInput, 'phaseId'>> & { phaseId?: string };

export function updateSprint(s: Session, id: string, patch: SprintPatch): Sprint {
  const { sprint, project } = requireSprint(s, id);
  requireManager(s, project);
  const next = { ...sprint, ...patch };
  fail(validateSprint({ ...next, capacityHours: next.capacityHours ?? null }));
  if (patch.phaseId && !db().phases.some((ph) => ph.id === patch.phaseId && ph.projectId === project.id))
    throw new ValidationError('Choose a phase of this project.');
  const moved = patch.startDate !== undefined || patch.endDate !== undefined;
  Object.assign(sprint, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    capacityHours: patch.capacityHours === null ? undefined : (patch.capacityHours ?? sprint.capacityHours),
  });
  if (moved)
    log(
      s,
      project.id,
      'sprint.rescheduled',
      `${sprint.name} moved to ${sprint.startDate} – ${sprint.endDate}`,
    );
  else log(s, project.id, 'sprint.updated', `${sprint.name} updated`);
  return sprint;
}

export function startSprint(s: Session, id: string): Sprint {
  const { sprint, project } = requireSprint(s, id);
  requireManager(s, project);
  const rule = canStartSprint(sprint, db().sprints);
  if (!rule.ok) throw new ValidationError(rule.reason);
  sprint.status = 'active';
  log(s, project.id, 'sprint.started', `${sprint.name} started`);
  return sprint;
}

export interface CompletionResult {
  sprint: Sprint;
  moved: string[];
  targetSprintId: string | null;
}

export function completeSprint(s: Session, id: string, carryOver: CarryOver): CompletionResult {
  const { sprint, project } = requireSprint(s, id);
  requireManager(s, project);
  const d = db();
  const plan = planCompletion(
    sprint,
    d.sprints,
    d.items.filter((i) => i.projectId === project.id),
    carryOver,
  );
  if ('error' in plan) throw new ValidationError(plan.error);
  const t = now();
  for (const m of plan.moves) {
    const item = d.items.find((i) => i.id === m.itemId)!;
    Object.assign(item, { sprintId: m.sprintId, position: m.position, updatedAt: t });
  }
  sprint.status = 'completed';
  const target = plan.targetSprintId
    ? d.sprints.find((x) => x.id === plan.targetSprintId)!.name
    : 'the backlog';
  const n = plan.moves.length;
  log(
    s,
    project.id,
    'sprint.completed',
    n
      ? `${sprint.name} completed; ${n} unfinished item${n === 1 ? '' : 's'} moved to ${target}`
      : `${sprint.name} completed with all work finished`,
  );
  return { sprint, moved: plan.unfinished.map((i) => i.key), targetSprintId: plan.targetSprintId };
}

export function setHoursPerPoint(s: Session, projectKey: string, hoursPerPoint: number) {
  const p = requireProject(s, projectKey);
  requireManager(s, p);
  if (!(hoursPerPoint > 0 && hoursPerPoint <= 100))
    throw new ValidationError('Hours per point must be between 0 and 100.');
  const settings = db().planning.settings;
  const row = settings.find((x) => x.projectId === p.id);
  if (row) row.hoursPerPoint = hoursPerPoint;
  else settings.push({ projectId: p.id, hoursPerPoint });
  log(s, p.id, 'planning.updated', `Capacity conversion set to ${hoursPerPoint} h per point`);
  return { projectId: p.id, hoursPerPoint };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineItem = Pick<
  WorkItem,
  'id' | 'key' | 'title' | 'type' | 'status' | 'parentId' | 'sprintId' | 'phaseId' | 'dueDate'
>;

export interface TimelineData {
  project: Pick<Project, 'id' | 'key' | 'name' | 'startDate' | 'targetDate'>;
  phases: Phase[];
  sprints: Sprint[];
  items: TimelineItem[];
  links: Pick<ItemLink, 'id' | 'fromId' | 'toId' | 'type'>[];
  schedules: ItemSchedule[];
  canEdit: boolean;
}

export function getTimeline(s: Session, projectKey: string): TimelineData {
  const p = requireProject(s, projectKey);
  const d = db();
  const items = d.items.filter(
    (i) => i.projectId === p.id && !i.deletedAt && canSeeVisibility(s.user, i.visibility),
  );
  const ids = new Set(items.map((i) => i.id));
  return {
    project: { id: p.id, key: p.key, name: p.name, startDate: p.startDate, targetDate: p.targetDate },
    phases: d.phases.filter((ph) => ph.projectId === p.id).sort((a, b) => a.gate - b.gate),
    sprints: d.sprints.filter((x) => x.projectId === p.id),
    items: items.map(({ id, key, title, type, status, parentId, sprintId, phaseId, dueDate }) => ({
      id,
      key,
      title,
      type,
      status,
      parentId,
      sprintId,
      phaseId,
      dueDate,
    })),
    links: d.links
      .filter((l) => l.type === 'blocks' && ids.has(l.fromId) && ids.has(l.toId))
      .map(({ id, fromId, toId, type }) => ({ id, fromId, toId, type })),
    schedules: d.planning.schedules.filter((x) => x.projectId === p.id && ids.has(x.itemId)),
    canEdit: canManageProject(s.user, p),
  };
}

export interface RescheduleInput {
  kind: 'sprint' | 'epic';
  id: string;
  startDate: string;
  endDate: string;
}

/** Drag-to-reschedule: a sprint's own dates, or an explicit date range stored for an epic. */
export function reschedule(s: Session, projectKey: string, input: RescheduleInput) {
  const p = requireProject(s, projectKey);
  requireManager(s, p);
  if (input.kind === 'sprint') {
    const sprint = db().sprints.find((x) => x.id === input.id && x.projectId === p.id);
    if (!sprint) throw new NotFoundError('Sprint not found');
    return updateSprint(s, sprint.id, { startDate: input.startDate, endDate: input.endDate });
  }
  const d = db();
  const epic = d.items.find((i) => i.id === input.id && i.projectId === p.id && !i.deletedAt);
  if (!epic || epic.type !== 'epic') throw new NotFoundError('Epic not found');
  if (input.endDate < input.startDate)
    throw new ValidationError('End date must not be before the start date.');
  const row = d.planning.schedules.find((x) => x.itemId === epic.id);
  if (row) Object.assign(row, { startDate: input.startDate, endDate: input.endDate });
  else d.planning.schedules.push({ itemId: epic.id, projectId: p.id, ...pick(input) });
  log(s, p.id, 'epic.rescheduled', `${epic.key} scheduled ${input.startDate} – ${input.endDate}`);
  return d.planning.schedules.find((x) => x.itemId === epic.id)!;
}

const pick = ({ startDate, endDate }: RescheduleInput) => ({ startDate, endDate });
