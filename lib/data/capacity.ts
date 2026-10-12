import type { Profile, Project, ProjectMember, Session } from '../domain/types';
import { canManageProject, canSeeProject, isClientRole } from '../domain/permissions';
import {
  assignmentWarnings,
  buildGrid,
  capacityOf,
  cellLoad,
  cleanTags,
  canViewDirectory,
  canViewGrid,
  defaultAllocations,
  directoryEntry,
  forbiddenField,
  isMonday,
  isoWeekStart,
  nextWeeks,
  nonUsPeopleOn,
  restrictedRefusal,
  restrictFlipRefusal,
  RESTRICTED_REFUSED,
  usFlagRefusal,
  warningSummary,
  type CapacityGrid,
  type DirectoryEntry,
  type WeekWarning,
} from '../domain/capacity';
import type { AllocationInput, AssignInput, PersonPatch } from '../capacity-schemas';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresCapacityStore } from './capacity-postgres';

/**
 * People directory, allocation grid, project staffing and the restricted-project rule (KH-34/35/36).
 * `CapacityStore` has two implementations picked like getRepo(): `memoryCapacityStore` (demo
 * store, below) and the Postgres + RLS store in capacity-postgres.ts, where triggers from
 * 0011_capacity.sql also enforce the U.S.-person rule. Shared behaviour: contract-capacity.ts.
 */

export interface PersonDetail extends DirectoryEntry {
  /** Visible projects this person is staffed on. Omitted for viewers without directory details. */
  memberships?: {
    projectId: string;
    projectKey: string;
    projectName: string;
    projectRole: string;
    allocationPct: number;
  }[];
}

export interface TeamMember extends ProjectMember {
  name: string;
  title?: string;
  hoursPerWeek: number;
  usPerson?: boolean;
}

export interface ProjectTeam {
  project: Pick<Project, 'id' | 'key' | 'name' | 'restricted' | 'startDate' | 'targetDate'>;
  members: TeamMember[];
  /** Internal staff who can be assigned (restricted projects: U.S. persons only). Managers only. */
  candidates: { id: string; name: string; title?: string; usPerson: boolean; hoursPerWeek: number }[];
  canManage: boolean;
}

export interface AssignmentPreview {
  warnings: WeekWarning[];
  summary: string | null;
  /** Set when the assignment would be refused (restricted project, non-U.S. person). */
  refusal: string | null;
}

export interface CapacityStore {
  listDirectory(s: Session, now?: Date): Promise<DirectoryEntry[]>;
  getPerson(s: Session, id: string, now?: Date): Promise<PersonDetail>;
  updatePerson(s: Session, id: string, patch: PersonPatch, now?: Date): Promise<DirectoryEntry>;
  getGrid(s: Session, opts?: { from?: string; weeks?: number; now?: Date }): Promise<CapacityGrid>;
  setAllocation(s: Session, input: AllocationInput): Promise<{ hours: number }>;
  getTeam(s: Session, projectKey: string): Promise<ProjectTeam>;
  previewAssignment(
    s: Session,
    projectKey: string,
    input: Pick<AssignInput, 'userId' | 'allocationPct'>,
    now?: Date,
  ): Promise<AssignmentPreview>;
  assignMember(s: Session, projectKey: string, input: AssignInput, now?: Date): Promise<AssignmentPreview>;
  removeMember(s: Session, projectKey: string, userId: string, now?: Date): Promise<void>;
  setRestricted(s: Session, projectKey: string, restricted: boolean): Promise<{ restricted: boolean }>;
}

// ---------------------------------------------------------------------------
// Demo store
// ---------------------------------------------------------------------------
const internalPeople = () =>
  db()
    .profiles.filter((p) => !isClientRole(p.role))
    .sort((a, b) => a.name.localeCompare(b.name));

function requireDirectory(s: Session) {
  if (!canViewDirectory(s.user)) throw new ForbiddenError('The people directory is for Konnector staff.');
}

function visibleProject(s: Session, idOrKey: string): Project {
  const d = db();
  const p = d.projects.find((x) => x.id === idOrKey || x.key === idOrKey.toUpperCase());
  if (!p || p.deletedAt || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

function managedProject(s: Session, idOrKey: string): Project {
  const p = visibleProject(s, idOrKey);
  if (!canManageProject(s.user, p))
    throw new ForbiddenError('Only Admins and the project’s Delivery Lead can change staffing.');
  return p;
}

function person(id: string): Profile {
  const p = db().profiles.find((x) => x.id === id);
  if (!p || isClientRole(p.role)) throw new ValidationError('Unknown person.');
  return p;
}

function audit(
  s: Session,
  action: string,
  entity: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  db().audit.push({
    id: newId('au'),
    actorId: s.user.id,
    action,
    entity,
    entityId,
    before,
    after,
    at: new Date().toISOString(),
  });
}

/** Audits the refused attempt (SEC-02), then throws the refusal. */
function refuse(s: Session, project: Project, message: string, after: Record<string, unknown>): never {
  audit(s, RESTRICTED_REFUSED, 'project', project.id, undefined, { ...after, message });
  throw new ValidationError(message);
}

const hoursIn = (userId: string, week: string, exceptProjectId?: string) =>
  db()
    .capacity.allocations.filter(
      (a) => a.userId === userId && a.week === week && a.projectId !== exceptProjectId,
    )
    .reduce((sum, a) => sum + a.hours, 0);

function currentPct(p: Profile, now: Date) {
  return cellLoad(hoursIn(p.id, isoWeekStart(now)), capacityOf(p)).pct;
}

function entry(s: Session, p: Profile, now: Date): DirectoryEntry {
  return directoryEntry(s.user, p, db().capacity.extras[p.id], currentPct(p, now));
}

function preview(project: Project, p: Profile, pct: number, now: Date): AssignmentPreview {
  const weeks = nextWeeks(now);
  const cap = capacityOf(p);
  const planned = new Map(defaultAllocations(cap, pct, project, weeks).map((a) => [a.week, a.hours]));
  const warnings = assignmentWarnings(
    cap,
    weeks.map((week) => ({
      week,
      otherHours: hoursIn(p.id, week, project.id),
      newHours: planned.get(week) ?? 0,
    })),
  );
  return { warnings, summary: warningSummary(p.name, warnings), refusal: restrictedRefusal(project, p) };
}

async function memListDirectory(s: Session, now: Date = new Date()): Promise<DirectoryEntry[]> {
  requireDirectory(s);
  return internalPeople().map((p) => entry(s, p, now));
}

async function memGetPerson(s: Session, id: string, now: Date = new Date()): Promise<PersonDetail> {
  requireDirectory(s);
  const p = internalPeople().find((x) => x.id === id);
  if (!p) throw new NotFoundError('Person not found');
  const e: PersonDetail = entry(s, p, now);
  if (e.role === undefined) return e;
  const d = db();
  e.memberships = d.members
    .filter((m) => m.userId === p.id)
    .flatMap((m) => {
      const pr = d.projects.find((x) => x.id === m.projectId);
      return pr && !pr.deletedAt && canSeeProject(s.user, pr, d.members)
        ? [
            {
              projectId: pr.id,
              projectKey: pr.key,
              projectName: pr.name,
              projectRole: m.projectRole,
              allocationPct: m.allocationPct,
            },
          ]
        : [];
    })
    .sort((a, b) => a.projectKey.localeCompare(b.projectKey));
  return e;
}

async function memUpdatePerson(s: Session, id: string, patch: PersonPatch, now: Date = new Date()) {
  requireDirectory(s);
  const bad = forbiddenField(s.user, patch);
  if (bad)
    throw new ForbiddenError(
      s.user.role === 'delivery_lead'
        ? 'Delivery Leads can edit skills and certifications only.'
        : 'Only Admins and Delivery Leads can edit the directory.',
    );
  const d = db();
  const p = internalPeople().find((x) => x.id === id);
  if (!p) throw new NotFoundError('Person not found');
  if (patch.usPerson === false && p.usPerson) {
    const keys = d.projects
      .filter(
        (pr) =>
          pr.restricted && !pr.deletedAt && d.members.some((m) => m.projectId === pr.id && m.userId === p.id),
      )
      .map((pr) => pr.key);
    const msg = usFlagRefusal(p.name, keys);
    if (msg) {
      audit(s, RESTRICTED_REFUSED, 'profile', p.id, undefined, { usPerson: false, message: msg });
      throw new ValidationError(msg);
    }
  }
  const before = { usPerson: p.usPerson, costRate: p.costRate };
  const extras = (d.capacity.extras[p.id] ??= { certifications: [] });
  if (patch.title !== undefined) p.title = patch.title;
  if (patch.skills !== undefined) p.skills = cleanTags(patch.skills);
  if (patch.certifications !== undefined) extras.certifications = cleanTags(patch.certifications);
  if (patch.location !== undefined) extras.location = patch.location || undefined;
  if (patch.timezone !== undefined) p.timezone = patch.timezone || undefined;
  if (patch.hoursPerWeek !== undefined) p.hoursPerWeek = patch.hoursPerWeek;
  if (patch.usPerson !== undefined) p.usPerson = patch.usPerson;
  if (patch.costRate !== undefined) p.costRate = patch.costRate;
  if (patch.usPerson !== undefined && patch.usPerson !== before.usPerson)
    audit(s, 'profile.us_person', 'profile', p.id, before.usPerson, p.usPerson);
  if (patch.costRate !== undefined && patch.costRate !== before.costRate)
    audit(s, 'profile.cost_rate', 'profile', p.id, before.costRate ?? null, p.costRate);
  return entry(s, p, now);
}

async function memGetGrid(
  s: Session,
  opts: { from?: string; weeks?: number; now?: Date } = {},
): Promise<CapacityGrid> {
  if (!canViewGrid(s.user))
    throw new ForbiddenError('The allocation grid is for Admins, Leads and Team Members.');
  const d = db();
  const from =
    opts.from && isMonday(opts.from) ? new Date(`${opts.from}T00:00:00Z`) : (opts.now ?? new Date());
  const weeks = nextWeeks(from, opts.weeks);
  const projects = d.projects
    .filter((p) => !p.deletedAt && canSeeProject(s.user, p, d.members))
    .sort((a, b) => a.key.localeCompare(b.key));
  const ids = new Set(projects.map((p) => p.id));
  const people = internalPeople();
  const inWeeks = d.capacity.allocations.filter((a) => weeks.includes(a.week));
  const totals = people.flatMap((p) =>
    weeks.map((week) => ({ userId: p.id, week, hours: hoursIn(p.id, week) })),
  );
  return buildGrid({
    weeks,
    people,
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      editable: canManageProject(s.user, p),
    })),
    members: d.members.filter((m) => ids.has(m.projectId)),
    allocations: inWeeks.filter((a) => ids.has(a.projectId)),
    totals,
  });
}

async function memSetAllocation(s: Session, input: AllocationInput): Promise<{ hours: number }> {
  const project = managedProject(s, input.projectId);
  if (!isMonday(input.week)) throw new ValidationError('Week must be the Monday of an ISO week.');
  const p = person(input.userId);
  const d = db();
  const msg = input.hours > 0 ? restrictedRefusal(project, p) : null;
  if (msg) refuse(s, project, msg, { userId: p.id, via: 'allocation' });
  const existing = d.capacity.allocations.find(
    (a) => a.projectId === project.id && a.userId === p.id && a.week === input.week,
  );
  const hours = Math.round(input.hours * 100) / 100;
  if (existing) existing.hours = hours;
  else
    d.capacity.allocations.push({
      id: newId('al'),
      projectId: project.id,
      userId: p.id,
      week: input.week,
      hours,
    });
  d.capacity.allocations = d.capacity.allocations.filter((a) => a.hours > 0);
  return { hours };
}

async function memGetTeam(s: Session, projectKey: string): Promise<ProjectTeam> {
  requireDirectory(s);
  const project = visibleProject(s, projectKey);
  const d = db();
  const canManage = canManageProject(s.user, project);
  const showUs = s.user.role === 'admin' || s.user.role === 'delivery_lead';
  const members = d.members
    .filter((m) => m.projectId === project.id)
    .map((m): TeamMember => {
      const p = d.profiles.find((x) => x.id === m.userId)!;
      return {
        ...m,
        name: p.name,
        title: p.title,
        hoursPerWeek: capacityOf(p),
        ...(showUs ? { usPerson: p.usPerson } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      restricted: project.restricted,
      startDate: project.startDate,
      targetDate: project.targetDate,
    },
    members,
    candidates: canManage
      ? internalPeople().map((p) => ({
          id: p.id,
          name: p.name,
          title: p.title,
          usPerson: p.usPerson,
          hoursPerWeek: capacityOf(p),
        }))
      : [],
    canManage,
  };
}

async function memPreview(
  s: Session,
  projectKey: string,
  input: Pick<AssignInput, 'userId' | 'allocationPct'>,
  now: Date = new Date(),
) {
  const project = managedProject(s, projectKey);
  return preview(project, person(input.userId), input.allocationPct, now);
}

async function memAssign(s: Session, projectKey: string, input: AssignInput, now: Date = new Date()) {
  const project = managedProject(s, projectKey);
  const p = person(input.userId);
  const result = preview(project, p, input.allocationPct, now);
  if (result.refusal) refuse(s, project, result.refusal, { userId: p.id, via: 'project_member' });
  const d = db();
  const existing = d.members.find((m) => m.projectId === project.id && m.userId === p.id);
  const before = existing ? { ...existing } : undefined;
  if (existing)
    Object.assign(existing, { projectRole: input.projectRole, allocationPct: input.allocationPct });
  else
    d.members.push({
      projectId: project.id,
      userId: p.id,
      projectRole: input.projectRole,
      allocationPct: input.allocationPct,
    });
  // Re-seed this project's weekly hours for the person across the 12-week view.
  const weeks = nextWeeks(now);
  d.capacity.allocations = d.capacity.allocations.filter(
    (a) => !(a.projectId === project.id && a.userId === p.id && weeks.includes(a.week)),
  );
  for (const a of defaultAllocations(capacityOf(p), input.allocationPct, project, weeks))
    d.capacity.allocations.push({ id: newId('al'), projectId: project.id, userId: p.id, ...a });
  audit(s, 'project.member_assign', 'project', project.id, before, {
    userId: p.id,
    projectRole: input.projectRole,
    allocationPct: input.allocationPct,
  });
  return result;
}

async function memRemove(s: Session, projectKey: string, userId: string, now: Date = new Date()) {
  const project = managedProject(s, projectKey);
  const d = db();
  const before = d.members.find((m) => m.projectId === project.id && m.userId === userId);
  if (!before) throw new NotFoundError('Not a member of this project');
  d.members = d.members.filter((m) => m !== before);
  const from = isoWeekStart(now);
  d.capacity.allocations = d.capacity.allocations.filter(
    (a) => !(a.projectId === project.id && a.userId === userId && a.week >= from),
  );
  audit(s, 'project.member_remove', 'project', project.id, before, undefined);
}

async function memSetRestricted(s: Session, projectKey: string, restricted: boolean) {
  const project = managedProject(s, projectKey);
  const d = db();
  if (restricted && !project.restricted) {
    const names = nonUsPeopleOn(project.id, d.profiles, {
      members: d.members,
      assigneeIds: d.items
        .filter((i) => i.projectId === project.id && !i.deletedAt && i.assigneeId)
        .map((i) => i.assigneeId!),
      allocationUserIds: d.capacity.allocations
        .filter((a) => a.projectId === project.id)
        .map((a) => a.userId),
    });
    const msg = restrictFlipRefusal(project.key, names);
    if (msg) refuse(s, project, msg, { restricted: true, people: names });
  }
  if (project.restricted !== restricted) {
    audit(s, 'project.restricted', 'project', project.id, project.restricted, restricted);
    project.restricted = restricted;
  }
  return { restricted: project.restricted };
}

/** The demo-store implementation. */
export const memoryCapacityStore: CapacityStore = {
  listDirectory: memListDirectory,
  getPerson: memGetPerson,
  updatePerson: memUpdatePerson,
  getGrid: memGetGrid,
  setAllocation: memSetAllocation,
  getTeam: memGetTeam,
  previewAssignment: memPreview,
  assignMember: memAssign,
  removeMember: memRemove,
  setRestricted: memSetRestricted,
};

/** The active capacity store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const capacityStore = (): CapacityStore =>
  isPostgresEnabled() ? postgresCapacityStore() : memoryCapacityStore;
