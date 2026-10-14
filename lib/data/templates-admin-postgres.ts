import type { Session } from '../domain/types';
import {
  resolveWorkflow,
  templateCreateSchema,
  type TemplateSummary,
  type WorkflowStatus,
} from '../domain/admin';
import { isClientRole } from '../domain/permissions';
import { TEMPLATES } from '../domain/templates';
import type { TemplateStore } from './templates-admin';
import { prepareTemplate, prepareWorkflow, TEMPLATES_INTERNAL } from './templates-admin';
import {
  asUser,
  audit,
  findProject,
  getSql,
  jsonb,
  textArray,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { withClientIp } from './admin-postgres';
import { ForbiddenError, NotFoundError } from './errors';
import { requireAdmin } from './admin-rules';

const toTemplate = (r: Row): TemplateSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  phases: (r.phases as TemplateSummary['phases']).map((p) => ({
    gate: p.gate,
    name: p.name,
    criteria: [...p.criteria],
  })),
  raidCategories: r.raid_categories ?? [],
  builtin: r.builtin,
  baseId: r.base_id ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.builtin ? null : r.created_at,
  archivedAt: r.archived_at ?? null,
});

/** Templates and workflows on Postgres + RLS (0017): Admin-only writes, built-ins read-only. */
export function createPostgresTemplateStore(sql: Sql): TemplateStore {
  const run = <T>(s: Session, ip: string | undefined, fn: (tx: Tx) => Promise<T>) =>
    asUser(sql, s.user.id, async (tx) => {
      await withClientIp(tx, ip);
      return fn(tx);
    });

  // Built-ins first, in the order of lib/domain/templates.ts; then custom ones, oldest first.
  const all = async (tx: Tx) =>
    (
      await tx`
        select * from public.templates
        order by array_position(${textArray(TEMPLATES.map((t) => t.id))}::text[], id) nulls last, created_at, id`
    ).map(toTemplate);

  return {
    async listTemplates(s, opts = {}) {
      if (isClientRole(s.user.role)) throw new ForbiddenError(TEMPLATES_INTERNAL);
      return run(s, undefined, async (tx) => {
        const list = await all(tx);
        return opts.includeArchived && s.user.role === 'admin' ? list : list.filter((t) => !t.archivedAt);
      });
    },

    async createTemplate(s, input, ip) {
      requireAdmin(s, 'create templates');
      return run(s, ip, async (tx) => {
        const tpl = prepareTemplate(input, await all(tx));
        const [r] = await tx`
          insert into public.templates (id, name, description, base_id, phases, raid_categories, created_by)
          values (${tpl.id}, ${tpl.name}, ${tpl.description}, ${templateCreateSchema.parse(input).baseId},
                  ${jsonb(tx, tpl.phases)}, ${textArray(tpl.raidCategories)}::text[], ${s.user.id})
          returning *`;
        const out = toTemplate(r);
        await audit(tx, s, null, 'template.create', 'template', out.id, undefined, out);
        return out;
      });
    },

    async archiveTemplate(s, id, ip) {
      requireAdmin(s, 'archive templates');
      return run(s, ip, async (tx) => {
        const [t] = await tx`select builtin, archived_at from public.templates where id = ${id}`;
        if (!t) throw new NotFoundError('Template not found');
        if (t.builtin) throw new ForbiddenError('Built-in templates cannot be archived.');
        if (t.archived_at) return;
        const [r] =
          await tx`update public.templates set archived_at = now() where id = ${id} returning archived_at`;
        await audit(tx, s, null, 'template.archive', 'template', id, undefined, {
          archivedAt: r.archived_at,
        });
      });
    },

    async getWorkflow(s, projectKey) {
      return run(s, undefined, async (tx) => {
        const p = await findProject(tx, projectKey);
        const [w] = await tx`select statuses from public.project_workflows where project_id = ${p.id}`;
        return resolveWorkflow(w?.statuses as WorkflowStatus[] | undefined);
      });
    },

    async updateWorkflow(s, projectKey, input, ip) {
      requireAdmin(s, 'configure workflows');
      const statuses = prepareWorkflow(input);
      return run(s, ip, async (tx) => {
        const p = await findProject(tx, projectKey);
        const [w] = await tx`select statuses from public.project_workflows where project_id = ${p.id}`;
        await tx`
          insert into public.project_workflows (project_id, statuses, updated_by)
          values (${p.id}, ${jsonb(tx, statuses)}, ${s.user.id})
          on conflict (project_id) do update set statuses = excluded.statuses, updated_by = excluded.updated_by`;
        await audit(
          tx,
          s,
          p.id,
          'workflow.update',
          'project',
          p.id,
          resolveWorkflow(w?.statuses as WorkflowStatus[] | undefined),
          statuses,
        );
        return statuses;
      });
    },
  };
}

let store: TemplateStore | undefined;
export const postgresTemplateStore = (): TemplateStore => (store ??= createPostgresTemplateStore(getSql()));
