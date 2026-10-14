import type { Session } from '../domain/types';
import { canSeeFinancials, isClientRole } from '../domain/permissions';
import {
  canLogTime,
  canSeeTimeCost,
  costCents,
  hoursError,
  isIsoDate,
  rejectReasonError,
  sumHours,
  weekDays,
  type TimeEntryView,
} from '../domain/ledger';
import type { LedgerStore } from './ledger';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import {
  asUser,
  findItem,
  findProject,
  getSql,
  isUuid,
  num,
  textArray,
  type Row,
  type Sql,
  type Tx,
} from './postgres';

/**
 * Time tracking on Postgres + RLS (time_entries from 0001, approval lifecycle from 0012_ledger).
 * Every call is one transaction as the signed-in user, so RLS decides which rows each person
 * reads and writes, and the time_entry_rules trigger enforces the lifecycle (approved rows are
 * locked, only the Lead / Admin decides, a rejection needs a reason). Cost rates come from
 * profile_rates, which RLS only shows to Admins.
 */

const SELECT = (tx: Tx) => tx`
  select t.*, p.key as project_key, w.key as item_key, w.title as item_title,
         u.name as user_name, d.name as decided_by_name, r.cost_rate
    from public.time_entries t
    join public.projects p on p.id = t.project_id
    left join public.work_items w on w.id = t.item_id
    left join public.profiles u on u.id = t.user_id
    left join public.profiles d on d.id = t.decided_by
    left join public.profile_rates r on r.profile_id = t.user_id`;

function toView(s: Session, r: Row): TimeEntryView {
  const hours = Number(r.hours);
  const v: TimeEntryView = {
    id: r.id,
    projectId: r.project_id,
    itemId: r.item_id ?? null,
    userId: r.user_id,
    date: r.entry_date,
    hours,
    billable: r.billable,
    note: r.note ?? '',
    status: r.status,
    submittedAt: r.submitted_at ?? null,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null,
    rejectReason: r.reject_reason ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    projectKey: r.project_key,
    itemKey: r.item_key ?? null,
    itemTitle: r.item_title ?? null,
    userName: r.user_name ?? '—',
    decidedByName: r.decided_by_name ?? null,
  };
  if (canSeeTimeCost(s.user)) {
    const rate = num(r.cost_rate);
    v.costRate = rate;
    v.costCents = rate == null ? null : costCents(hours, rate);
  }
  return v;
}

function requireInternal(s: Session) {
  if (!canLogTime(s.user.role)) throw new ForbiddenError('Time tracking is for Konnector staff.');
}

function requireApprover(s: Session) {
  if (s.user.role !== 'admin' && s.user.role !== 'delivery_lead')
    throw new ForbiddenError('Only Delivery Leads and Admins approve time.');
}

function checkFields(p: { date?: string; hours?: number }) {
  if (p.date !== undefined && !isIsoDate(p.date)) throw new ValidationError('Enter a valid date.');
  if (p.hours !== undefined) {
    const err = hoursError(p.hours);
    if (err) throw new ValidationError(err);
  }
}

function checkWeek(weekStart: string) {
  if (!isIsoDate(weekStart) || new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1)
    throw new ValidationError('A week starts on a Monday (YYYY-MM-DD).');
}

async function ownRow(tx: Tx, s: Session, id: string): Promise<Row> {
  const [row] = isUuid(id)
    ? await tx`select * from public.time_entries where id = ${id} and user_id = ${s.user.id}`
    : [];
  if (!row) throw new NotFoundError('Time entry not found');
  if (row.status === 'approved') throw new ForbiddenError('Approved time is locked.');
  if (row.status === 'submitted')
    throw new ForbiddenError('Submitted time is read-only until your Lead decides.');
  return row;
}

async function byId(tx: Tx, s: Session, id: string) {
  const [row] = await tx`${SELECT(tx)} where t.id = ${id}`;
  return toView(s, row);
}

export function createPostgresLedgerStore(sql: Sql): LedgerStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);

  return {
    async logTime(s, input) {
      requireInternal(s);
      return run(s, async (tx) => {
        const item = await findItem(tx, input.itemId);
        checkFields(input);
        const [row] = await tx`
          insert into public.time_entries (project_id, item_id, user_id, entry_date, hours, billable, note)
          values (${item.projectId}, ${item.id}, ${s.user.id}, ${input.date}, ${input.hours},
                  ${input.billable ?? true}, ${input.note?.trim() ?? ''})
          returning id`;
        return byId(tx, s, row.id);
      });
    },

    async updateTime(s, id, patch) {
      requireInternal(s);
      return run(s, async (tx) => {
        const row = await ownRow(tx, s, id);
        checkFields(patch);
        await tx`
          update public.time_entries set
            entry_date = ${patch.date ?? row.entry_date},
            hours = ${patch.hours ?? row.hours},
            billable = ${patch.billable ?? row.billable},
            note = ${patch.note !== undefined ? patch.note.trim() : row.note},
            status = 'draft'
          where id = ${row.id}`;
        return byId(tx, s, row.id);
      });
    },

    async deleteTime(s, id) {
      requireInternal(s);
      await run(s, async (tx) => {
        const row = await ownRow(tx, s, id);
        await tx`delete from public.time_entries where id = ${row.id}`;
      });
    },

    async listWeek(s, weekStart) {
      requireInternal(s);
      checkWeek(weekStart);
      const days = weekDays(weekStart);
      return run(s, async (tx) =>
        (
          await tx`${SELECT(tx)}
            where t.user_id = ${s.user.id} and t.entry_date between ${days[0]} and ${days[6]}
            order by t.entry_date, t.created_at, t.id`
        ).map((r) => toView(s, r)),
      );
    },

    async submitWeek(s, weekStart) {
      requireInternal(s);
      checkWeek(weekStart);
      const days = weekDays(weekStart);
      return run(s, async (tx) => {
        const rows = await tx`
          update public.time_entries set status = 'submitted'
          where user_id = ${s.user.id} and status = 'draft'
            and entry_date between ${days[0]} and ${days[6]}
          returning id`;
        if (!rows.length) throw new ValidationError('There is no draft time to submit for this week.');
        return (
          await tx`${SELECT(tx)} where t.id = any(${textArray(rows.map((r) => r.id))}::uuid[])
                   order by t.entry_date, t.created_at, t.id`
        ).map((r) => toView(s, r));
      });
    },

    async listApprovals(s) {
      requireApprover(s);
      return run(s, async (tx) =>
        (
          await tx`${SELECT(tx)}
            where t.status = 'submitted' and public.can_manage_project(t.project_id)
            order by t.entry_date, t.created_at, t.id`
        ).map((r) => toView(s, r)),
      );
    },

    async decideTime(s, ids, decision, reason) {
      requireApprover(s);
      const err = rejectReasonError(decision, reason);
      if (err) throw new ValidationError(err);
      const unique = [...new Set(ids)];
      if (!unique.length) throw new ValidationError('Choose at least one time entry.');
      return run(s, async (tx) => {
        const found = unique.every(isUuid)
          ? await tx`select id, status, public.can_manage_project(project_id) as manage
                     from public.time_entries where id = any(${textArray(unique)}::uuid[])`
          : [];
        if (found.length !== unique.length) throw new NotFoundError('Time entry not found');
        if (found.some((r) => !r.manage))
          throw new ForbiddenError('Only the project Lead or an Admin can approve this time.');
        if (found.some((r) => r.status !== 'submitted'))
          throw new ValidationError('Only submitted time can be approved or rejected.');
        await tx`
          update public.time_entries
             set status = ${decision}, reject_reason = ${decision === 'rejected' ? reason!.trim() : null}
           where id = any(${textArray(unique)}::uuid[])`;
        return (
          await tx`${SELECT(tx)} where t.id = any(${textArray(unique)}::uuid[])
                   order by t.entry_date, t.created_at, t.id`
        ).map((r) => toView(s, r));
      });
    },

    async listApproved(s, f) {
      requireApprover(s);
      return run(s, async (tx) => {
        const project = f.projectKey ? await findProject(tx, f.projectKey) : null;
        return (
          await tx`${SELECT(tx)}
            where t.status = 'approved' and public.can_manage_project(t.project_id)
              ${project ? tx`and t.project_id = ${project.id}` : tx``}
              ${f.from ? tx`and t.entry_date >= ${f.from}` : tx``}
              ${f.to ? tx`and t.entry_date <= ${f.to}` : tx``}`
        )
          .map((r) => toView(s, r))
          .sort(
            (a, b) =>
              a.projectKey.localeCompare(b.projectKey) ||
              a.date.localeCompare(b.date) ||
              a.userName.localeCompare(b.userName) ||
              a.id.localeCompare(b.id),
          );
      });
    },

    async itemTime(s, itemKey) {
      requireInternal(s);
      return run(s, async (tx) => {
        const item = await findItem(tx, itemKey);
        const [{ total }] = await tx`select public.item_logged_hours(${item.id}) as total`;
        const mine = (
          await tx`${SELECT(tx)} where t.item_id = ${item.id} and t.user_id = ${s.user.id}
                   order by t.entry_date desc, t.created_at desc`
        ).map((r) => toView(s, r));
        return {
          itemId: item.id,
          itemKey: item.key,
          totalHours: Number(total),
          myHours: sumHours(mine),
          mine,
        };
      });
    },

    async approvedCost(s, projectKey, asOf) {
      return run(s, async (tx) => {
        const p = await findProject(tx, projectKey);
        if (isClientRole(s.user.role) || !canSeeFinancials(s.user))
          throw new ForbiddenError('Actual cost is visible to Admins and Delivery Leads only.');
        const [{ cents }] = await tx`select public.project_actual_cost(${p.id}, ${asOf}) as cents`;
        return Number(cents);
      });
    },
  };
}

let store: LedgerStore | undefined;
export const postgresLedgerStore = (): LedgerStore => (store ??= createPostgresLedgerStore(getSql()));
