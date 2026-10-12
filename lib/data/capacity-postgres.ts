import type { Profile, Project, Session } from '../domain/types';
import { canManageProject } from '../domain/permissions';
import {
  assignmentWarnings,
  buildGrid,
  canViewDirectory,
  canViewGrid,
  capacityOf,
  cellLoad,
  cleanTags,
  defaultAllocations,
  directoryEntry,
  forbiddenField,
  isMonday,
  isoWeekStart,
  nextWeeks,
  restrictedRefusal,
  restrictFlipRefusal,
  RESTRICTED_REFUSED,
  usFlagRefusal,
  warningSummary,
  type CapacityGrid,
  type DirectoryEntry,
} from '../domain/capacity';
import type { AllocationInput, AssignInput, PersonPatch } from '../capacity-schemas';
import type { AssignmentPreview, CapacityStore, PersonDetail, ProjectTeam, TeamMember } from './capacity';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import {
  asUser,
  audit,
  findProject,
  getSql,
  isUuid,
  textArray,
  toProfile,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Capacity on Postgres + RLS (0011_capacity.sql). Every call runs as the signed-in user, so RLS
 * decides which projects, members and allocations each role reads and writes; triggers refuse a
 * non-U.S. person on a restricted project for every writer. A refused attempt rolls its
 * transaction back, so the `security.restricted_refused` audit entry is written in its own one.
 */

const CLIENT_ROLES = textArray(['client_sponsor', 'client_member', 'client_viewer']);

type PersonRow = Profile & { certifications: string[]; location?: string };

const toPerson = (r: Row): PersonRow => ({
  ...toProfile(r),
  certifications: r.certifications ?? [],
  location: r.location ?? undefined,
});

class Refusal extends Error {
  constructor(
    message: string,
    readonly projectId: string | null,
    readonly entity: string,
    readonly entityId: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function createPostgresCapacityStore(sql: Sql): CapacityStore {
  /** Runs fn as the user; a Refusal is audited in a separate transaction and becomes a ValidationError. */
  async function run<T>(s: Session, fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await asUser(sql, s.user.id, fn);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      await asUser(sql, s.user.id, (tx) =>
        audit(tx, s, e.projectId, RESTRICTED_REFUSED, e.entity, e.entityId, undefined, {
          ...e.detail,
          message: e.message,
        }),
      );
      throw new ValidationError(e.message);
    }
  }

  const requireDirectory = (s: Session) => {
    if (!canViewDirectory(s.user)) throw new ForbiddenError('The people directory is for Konnector staff.');
  };

  async function internalPeople(tx: Tx, id?: string): Promise<PersonRow[]> {
    if (id !== undefined && !isUuid(id)) return [];
    const rows = await tx`
      select p.*, r.cost_rate from public.profiles p
      left join public.profile_rates r on r.profile_id = p.id
      where not (p.role::text = any(${CLIENT_ROLES}::text[])) ${id ? tx`and p.id = ${id}` : tx``}
      order by p.name`;
    return rows.map(toPerson);
  }

  async function person(tx: Tx, id: string): Promise<PersonRow> {
    const [p] = await internalPeople(tx, id);
    if (!p) throw new ValidationError('Unknown person.');
    return p;
  }

  async function totals(tx: Tx, weeks: string[]) {
    const rows =
      await tx`select * from public.capacity_week_totals(${weeks[0]}::date, ${weeks[weeks.length - 1]}::date)`;
    return rows.map((r) => ({ userId: r.user_id as string, week: r.week as string, hours: Number(r.hours) }));
  }

  async function managed(tx: Tx, s: Session, key: string): Promise<Project> {
    const project = await findProject(tx, key);
    if (project.deletedAt) throw new NotFoundError('Project not found');
    if (!canManageProject(s.user, project))
      throw new ForbiddenError('Only Admins and the project’s Delivery Lead can change staffing.');
    return project;
  }

  async function entries(tx: Tx, s: Session, people: PersonRow[], now: Date): Promise<DirectoryEntry[]> {
    const week = isoWeekStart(now);
    const t = await totals(tx, [week]);
    return people.map((p) =>
      directoryEntry(
        s.user,
        p,
        { certifications: p.certifications, location: p.location },
        cellLoad(t.find((x) => x.userId === p.id)?.hours ?? 0, capacityOf(p)).pct,
      ),
    );
  }

  async function preview(
    tx: Tx,
    project: Project,
    p: PersonRow,
    pct: number,
    now: Date,
  ): Promise<AssignmentPreview> {
    const weeks = nextWeeks(now);
    const cap = capacityOf(p);
    const all = await totals(tx, weeks);
    const mine = await tx`
      select start_date as week, hours from public.allocations
      where project_id = ${project.id} and user_id = ${p.id}
        and start_date between ${weeks[0]}::date and ${weeks[weeks.length - 1]}::date`;
    const planned = new Map(defaultAllocations(cap, pct, project, weeks).map((a) => [a.week, a.hours]));
    const warnings = assignmentWarnings(
      cap,
      weeks.map((week) => {
        const total = all.find((x) => x.userId === p.id && x.week === week)?.hours ?? 0;
        const own = Number(mine.find((r) => r.week === week)?.hours ?? 0);
        return { week, otherHours: Math.max(0, total - own), newHours: planned.get(week) ?? 0 };
      }),
    );
    return { warnings, summary: warningSummary(p.name, warnings), refusal: restrictedRefusal(project, p) };
  }

  return {
    async listDirectory(s, now = new Date()) {
      requireDirectory(s);
      return run(s, async (tx) => entries(tx, s, await internalPeople(tx), now));
    },

    async getPerson(s, id, now = new Date()) {
      requireDirectory(s);
      return run(s, async (tx) => {
        const people = await internalPeople(tx, id);
        if (!people.length) throw new NotFoundError('Person not found');
        const [e] = (await entries(tx, s, people, now)) as PersonDetail[];
        if (e.role === undefined) return e;
        const rows = await tx`
          select m.project_id, m.project_role, m.allocation_pct, p.key, p.name
          from public.project_members m join public.projects p on p.id = m.project_id
          where m.user_id = ${id} and p.deleted_at is null order by p.key`;
        e.memberships = rows.map((r) => ({
          projectId: r.project_id,
          projectKey: r.key,
          projectName: r.name,
          projectRole: r.project_role,
          allocationPct: Number(r.allocation_pct),
        }));
        return e;
      });
    },

    async updatePerson(s, id, patch: PersonPatch, now = new Date()) {
      requireDirectory(s);
      if (forbiddenField(s.user, patch))
        throw new ForbiddenError(
          s.user.role === 'delivery_lead'
            ? 'Delivery Leads can edit skills and certifications only.'
            : 'Only Admins and Delivery Leads can edit the directory.',
        );
      return run(s, async (tx) => {
        const [p] = await internalPeople(tx, id);
        if (!p) throw new NotFoundError('Person not found');
        if (patch.usPerson === false && p.usPerson) {
          const rows = await tx`
            select p.key from public.projects p join public.project_members m on m.project_id = p.id
            where p.restricted and p.deleted_at is null and m.user_id = ${p.id}`;
          const msg = usFlagRefusal(
            p.name,
            rows.map((r) => r.key),
          );
          if (msg) throw new Refusal(msg, null, 'profile', p.id, { usPerson: false });
        }
        if (patch.skills !== undefined || patch.certifications !== undefined)
          await tx`select public.set_person_tags(${p.id}::uuid,
                     ${patch.skills ? textArray(cleanTags(patch.skills)) : null}::text[],
                     ${patch.certifications ? textArray(cleanTags(patch.certifications)) : null}::text[])`;
        const set: Row = {};
        if (patch.title !== undefined) set.title = patch.title;
        if (patch.location !== undefined) set.location = patch.location || null;
        if (patch.timezone !== undefined) set.timezone = patch.timezone || null;
        if (patch.hoursPerWeek !== undefined) set.hours_per_week = patch.hoursPerWeek;
        if (patch.usPerson !== undefined) set.us_person = patch.usPerson;
        if (Object.keys(set).length) await tx`update public.profiles set ${tx(set)} where id = ${p.id}`;
        if (patch.costRate !== undefined)
          await tx`insert into public.profile_rates (profile_id, cost_rate) values (${p.id}, ${patch.costRate})
                   on conflict (profile_id) do update set cost_rate = excluded.cost_rate, updated_at = now()`;
        if (patch.usPerson !== undefined && patch.usPerson !== p.usPerson)
          await audit(tx, s, null, 'profile.us_person', 'profile', p.id, p.usPerson, patch.usPerson);
        if (patch.costRate !== undefined && patch.costRate !== p.costRate)
          await audit(tx, s, null, 'profile.cost_rate', 'profile', p.id, p.costRate ?? null, patch.costRate);
        return (await entries(tx, s, await internalPeople(tx, p.id), now))[0];
      });
    },

    async getGrid(s, opts = {}): Promise<CapacityGrid> {
      if (!canViewGrid(s.user))
        throw new ForbiddenError('The allocation grid is for Admins, Leads and Team Members.');
      const from =
        opts.from && isMonday(opts.from) ? new Date(`${opts.from}T00:00:00Z`) : (opts.now ?? new Date());
      const weeks = nextWeeks(from, opts.weeks);
      return run(s, async (tx) => {
        const [projects, members, allocations, people, t] = await Promise.all([
          tx`select id, key, name, lead_id from public.projects where deleted_at is null order by key`,
          tx`select m.project_id, m.user_id from public.project_members m
             join public.projects p on p.id = m.project_id where p.deleted_at is null`,
          tx`select a.project_id, a.user_id, a.start_date as week, a.hours from public.allocations a
             join public.projects p on p.id = a.project_id and p.deleted_at is null
             where a.start_date between ${weeks[0]}::date and ${weeks[weeks.length - 1]}::date`,
          internalPeople(tx),
          totals(tx, weeks),
        ]);
        return buildGrid({
          weeks,
          people,
          projects: projects.map((p) => ({
            id: p.id,
            key: p.key,
            name: p.name,
            editable: canManageProject(s.user, { leadId: p.lead_id } as Project),
          })),
          members: members.map((m) => ({ projectId: m.project_id, userId: m.user_id })),
          allocations: allocations.map((a) => ({
            projectId: a.project_id,
            userId: a.user_id,
            week: a.week,
            hours: Number(a.hours),
          })),
          totals: t,
        });
      });
    },

    async setAllocation(s, input: AllocationInput) {
      if (!isMonday(input.week)) throw new ValidationError('Week must be the Monday of an ISO week.');
      return run(s, async (tx) => {
        const project = await managed(tx, s, input.projectId);
        const p = await person(tx, input.userId);
        const hours = Math.round(input.hours * 100) / 100;
        const msg = hours > 0 ? restrictedRefusal(project, p) : null;
        if (msg)
          throw new Refusal(msg, project.id, 'project', project.id, { userId: p.id, via: 'allocation' });
        if (hours > 0)
          await tx`insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours)
                   values (${project.id}, ${p.id}, ${input.week}::date, ${input.week}::date + 6, 0, ${hours})
                   on conflict (project_id, user_id, start_date) do update set hours = excluded.hours`;
        else
          await tx`delete from public.allocations
                   where project_id = ${project.id} and user_id = ${p.id} and start_date = ${input.week}::date`;
        return { hours };
      });
    },

    async getTeam(s, projectKey): Promise<ProjectTeam> {
      requireDirectory(s);
      return run(s, async (tx) => {
        const project = await findProject(tx, projectKey);
        if (project.deletedAt) throw new NotFoundError('Project not found');
        const canManage = canManageProject(s.user, project);
        const showUs = s.user.role === 'admin' || s.user.role === 'delivery_lead';
        const rows = await tx`
          select m.*, u.name, u.title, u.hours_per_week, u.us_person
          from public.project_members m join public.profiles u on u.id = m.user_id
          where m.project_id = ${project.id} order by u.name`;
        const members = rows.map((r): TeamMember => ({
          projectId: r.project_id,
          userId: r.user_id,
          projectRole: r.project_role,
          allocationPct: Number(r.allocation_pct),
          name: r.name,
          title: r.title ?? undefined,
          hoursPerWeek: capacityOf({
            hoursPerWeek: r.hours_per_week == null ? undefined : Number(r.hours_per_week),
          }),
          ...(showUs ? { usPerson: r.us_person } : {}),
        }));
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
            ? (await internalPeople(tx)).map((p) => ({
                id: p.id,
                name: p.name,
                title: p.title,
                usPerson: p.usPerson,
                hoursPerWeek: capacityOf(p),
              }))
            : [],
          canManage,
        };
      });
    },

    async previewAssignment(s, projectKey, input, now = new Date()) {
      return run(s, async (tx) =>
        preview(
          tx,
          await managed(tx, s, projectKey),
          await person(tx, input.userId),
          input.allocationPct,
          now,
        ),
      );
    },

    async assignMember(s, projectKey, input: AssignInput, now = new Date()) {
      return run(s, async (tx) => {
        const project = await managed(tx, s, projectKey);
        const p = await person(tx, input.userId);
        const result = await preview(tx, project, p, input.allocationPct, now);
        if (result.refusal)
          throw new Refusal(result.refusal, project.id, 'project', project.id, {
            userId: p.id,
            via: 'project_member',
          });
        const [before] = await tx`
          select project_role, allocation_pct from public.project_members
          where project_id = ${project.id} and user_id = ${p.id}`;
        await tx`insert into public.project_members (project_id, user_id, project_role, allocation_pct)
                 values (${project.id}, ${p.id}, ${input.projectRole}, ${input.allocationPct})
                 on conflict (project_id, user_id) do update
                   set project_role = excluded.project_role, allocation_pct = excluded.allocation_pct`;
        const weeks = nextWeeks(now);
        await tx`delete from public.allocations
                 where project_id = ${project.id} and user_id = ${p.id}
                   and start_date between ${weeks[0]}::date and ${weeks[weeks.length - 1]}::date`;
        for (const a of defaultAllocations(capacityOf(p), input.allocationPct, project, weeks))
          await tx`insert into public.allocations (project_id, user_id, start_date, end_date, pct, hours)
                   values (${project.id}, ${p.id}, ${a.week}::date, ${a.week}::date + 6, 0, ${a.hours})`;
        await audit(tx, s, project.id, 'project.member_assign', 'project', project.id, before ?? undefined, {
          userId: p.id,
          projectRole: input.projectRole,
          allocationPct: input.allocationPct,
        });
        return result;
      });
    },

    async removeMember(s, projectKey, userId, now = new Date()) {
      return run(s, async (tx) => {
        const project = await managed(tx, s, projectKey);
        const removed = isUuid(userId)
          ? await tx`delete from public.project_members where project_id = ${project.id} and user_id = ${userId}
                     returning project_role, allocation_pct`
          : [];
        if (!removed.length) throw new NotFoundError('Not a member of this project');
        await tx`delete from public.allocations
                 where project_id = ${project.id} and user_id = ${userId} and start_date >= ${isoWeekStart(now)}::date`;
        await audit(tx, s, project.id, 'project.member_remove', 'project', project.id, {
          userId,
          ...removed[0],
        });
      });
    },

    async setRestricted(s, projectKey, restricted) {
      return run(s, async (tx) => {
        const project = await managed(tx, s, projectKey);
        if (restricted && !project.restricted) {
          const [{ names }] = await tx`select public.non_us_people_on(${project.id}::uuid) as names`;
          const msg = restrictFlipRefusal(project.key, names ?? []);
          if (msg)
            throw new Refusal(msg, project.id, 'project', project.id, { restricted: true, people: names });
        }
        if (project.restricted !== restricted) {
          await tx`update public.projects set restricted = ${restricted} where id = ${project.id}`;
          await audit(
            tx,
            s,
            project.id,
            'project.restricted',
            'project',
            project.id,
            project.restricted,
            restricted,
          );
        }
        return { restricted };
      });
    },
  };
}

let store: CapacityStore | undefined;
export const postgresCapacityStore = (): CapacityStore => (store ??= createPostgresCapacityStore(getSql()));
