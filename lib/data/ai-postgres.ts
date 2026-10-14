import type { Project, Session } from '../domain/types';
import { isInternalRole } from '../domain/permissions';
import { AI_ENABLED_BY_DEFAULT, canToggleAi, type AiSettings } from '../domain/ai';
import type { StatusChange } from '../domain/metrics';
import { checkDecision, type AiSettingsView, type AiStore } from './ai';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { asUser, findProject, getSql, logActivity, textArray, uuidOr, type Sql, type Tx } from './postgres';

/**
 * AI assist on Postgres + RLS (supabase/migrations/0014_ai_assist.sql). Every call is one
 * transaction as the signed-in user: RLS lets only the Lead / Admin write ai_settings (a trigger
 * stamps who and when and writes the `ai.settings.update` audit entry) and only internal users
 * read or add suggestion decisions.
 */

async function visibleProject(tx: Tx, keyOrId: string): Promise<Project> {
  const p = await findProject(tx, keyOrId);
  if (p.deletedAt) throw new NotFoundError('Project not found');
  return p;
}

async function settingsView(tx: Tx, s: Session, p: Project): Promise<AiSettingsView> {
  const [row] = await tx`
    select a.enabled, a.updated_by, a.updated_at, u.name as updated_by_name
      from public.ai_settings a left join public.profiles u on u.id = a.updated_by
     where a.project_id = ${p.id}`;
  const st: AiSettings = {
    projectId: p.id,
    enabled: row ? Boolean(row.enabled) : AI_ENABLED_BY_DEFAULT,
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
  return {
    ...st,
    projectKey: p.key,
    canToggle: canToggleAi(s.user, p),
    updatedByName: row?.updated_by_name ?? null,
  };
}

const requireInternal = (s: Session) => {
  if (!isInternalRole(s.user.role)) throw new ForbiddenError('Risk suggestions are for the delivery team.');
};

export function createPostgresAiStore(sql: Sql): AiStore {
  const run = <T>(s: Session, fn: (tx: Tx) => Promise<T>) => asUser(sql, s.user.id, fn);
  return {
    async getSettings(s, projectKey) {
      return run(s, async (tx) => settingsView(tx, s, await visibleProject(tx, projectKey)));
    },

    async setEnabled(s, projectKey, enabled) {
      return run(s, async (tx) => {
        const p = await visibleProject(tx, projectKey);
        if (!canToggleAi(s.user, p))
          throw new ForbiddenError(
            'Only the project’s Delivery Lead or an Admin can turn AI assist on or off.',
          );
        await tx`
          insert into public.ai_settings (project_id, enabled) values (${p.id}, ${Boolean(enabled)})
          on conflict (project_id) do update set enabled = excluded.enabled`;
        await logActivity(
          tx,
          s,
          p.id,
          'ai.settings',
          `AI assist turned ${enabled ? 'on' : 'off'}`,
          'internal',
        );
        return settingsView(tx, s, p);
      });
    },

    async riskInputs(s, projectKey) {
      requireInternal(s);
      return run(s, async (tx) => {
        const p = await visibleProject(tx, projectKey);
        const [items, history, sprints, deliverables, links, decided] = await Promise.all([
          tx`select id, key, title, type, status, estimate, sprint_id, due_date, created_at, visibility
               from public.work_items where project_id = ${p.id} and deleted_at is null`,
          tx`select item_id, to_status, at from public.status_history where project_id = ${p.id}`,
          tx`select id, name, start_date, end_date, status from public.sprints where project_id = ${p.id}`,
          tx`select id, name, due_date, status, visibility from public.deliverables where project_id = ${p.id}`,
          tx`select deliverable_id, item_id from public.deliverable_items where project_id = ${p.id}`,
          tx`select signal_key from public.ai_suggestion_decisions where project_id = ${p.id}`,
        ]);
        const itemIds = new Map<string, string[]>();
        for (const l of links)
          itemIds.set(l.deliverable_id, [...(itemIds.get(l.deliverable_id) ?? []), l.item_id]);
        const day = (v: unknown) => (v == null ? null : String(v).slice(0, 10));
        return {
          project: p,
          items: items.map((i) => ({
            id: i.id,
            key: i.key,
            title: i.title,
            type: i.type,
            status: i.status,
            estimate: i.estimate == null ? null : Number(i.estimate),
            sprintId: i.sprint_id ?? null,
            dueDate: day(i.due_date),
            createdAt: new Date(i.created_at).toISOString(),
            visibility: i.visibility,
          })),
          history: history.map((h): Pick<StatusChange, 'itemId' | 'to' | 'at'> => ({
            itemId: h.item_id,
            to: h.to_status,
            at: new Date(h.at).toISOString(),
          })),
          sprints: sprints.map((x) => ({
            id: x.id,
            name: x.name,
            startDate: day(x.start_date)!,
            endDate: day(x.end_date)!,
            status: x.status,
          })),
          deliverables: deliverables.map((x) => ({
            id: x.id,
            name: x.name,
            dueDate: day(x.due_date),
            status: x.status,
            visibility: x.visibility,
            itemIds: itemIds.get(x.id) ?? [],
          })),
          decided: decided.map((d) => d.signal_key as string),
        };
      });
    },

    async recordDecision(s, projectKey, input) {
      requireInternal(s);
      const keys = checkDecision(input);
      return run(s, async (tx) => {
        const p = await visibleProject(tx, projectKey);
        const raidId = input.raidId ?? null;
        if (raidId) {
          const [r] =
            await tx`select 1 from public.raid_entries where id = ${uuidOr(raidId)} and project_id = ${p.id}`;
          if (!r) throw new ValidationError('RAID entry is not in this project.');
        }
        const rows = await tx`
          insert into public.ai_suggestion_decisions (project_id, signal_key, decision, raid_id)
          select ${p.id}, k, ${input.decision}, ${raidId}
            from unnest(${textArray(keys)}::text[]) as k
          on conflict (project_id, signal_key) do nothing
          returning signal_key`;
        return rows.map((r) => r.signal_key as string);
      });
    },
  };
}

let store: AiStore | undefined;
export const postgresAiStore = (): AiStore => (store ??= createPostgresAiStore(getSql()));
