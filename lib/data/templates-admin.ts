import type { Session } from '../domain/types';
import {
  buildCustomTemplate,
  builtinSummaries,
  normaliseWorkflow,
  resolveWorkflow,
  templateCreateSchema,
  templateIdFor,
  workflowSchema,
  type TemplateCreateInput,
  type TemplateSummary,
  type WorkflowInput,
  type WorkflowStatus,
} from '../domain/admin';
import { TEMPLATES } from '../domain/templates';
import { canSeeProject, isClientRole } from '../domain/permissions';
import { db } from './memory';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { writeAudit } from './gates';
import { isPostgresEnabled } from './index';
import { requireAdmin } from './admin-rules';
import { postgresTemplateStore } from './templates-admin-postgres';

/**
 * Project templates and per-project workflows (ADM-01). Konnector staff list templates (the
 * create-project dialog); Admins create custom templates from an existing one (editing exit
 * criteria and RAID categories) and archive them. Everyone on a project reads its workflow (the
 * board's column labels and WIP limits); only Admins change it, and Accepted stays fixed.
 * Postgres: `templates` and `project_workflows` (0017_portal_admin_files.sql).
 */
export interface TemplateStore {
  listTemplates(s: Session, opts?: { includeArchived?: boolean }): Promise<TemplateSummary[]>;
  createTemplate(s: Session, input: TemplateCreateInput, ip?: string): Promise<TemplateSummary>;
  archiveTemplate(s: Session, id: string, ip?: string): Promise<void>;
  getWorkflow(s: Session, projectKey: string): Promise<WorkflowStatus[]>;
  updateWorkflow(
    s: Session,
    projectKey: string,
    input: WorkflowInput,
    ip?: string,
  ): Promise<WorkflowStatus[]>;
}

export const TEMPLATES_INTERNAL = 'Project templates are visible to Konnector staff only.';

/** Shared by both stores: parse, find the base and build the template (readable errors). */
export function prepareTemplate(input: TemplateCreateInput, all: TemplateSummary[]) {
  const v = templateCreateSchema.parse(input);
  const base = all.find((t) => t.id === v.baseId && !t.archivedAt);
  if (!base) throw new ValidationError('Choose a template to start from.');
  if (all.some((t) => !t.archivedAt && t.name.toLowerCase() === v.name.toLowerCase()))
    throw new ValidationError(`A template called ${v.name} already exists.`);
  try {
    return buildCustomTemplate(
      base,
      v,
      templateIdFor(
        v.name,
        all.map((t) => t.id),
      ),
    );
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
}

export function prepareWorkflow(input: WorkflowInput): WorkflowStatus[] {
  const r = normaliseWorkflow(workflowSchema.parse(input).statuses);
  if (!r.ok) throw new ValidationError(r.error);
  return r.statuses;
}

/** Every template the demo store knows, built-ins first (used by createProject too). */
export const memoryTemplates = (): TemplateSummary[] => [
  ...builtinSummaries(TEMPLATES),
  ...db().admin.templates,
];

function visibleProject(s: Session, key: string) {
  const d = db();
  const p = d.projects.find((x) => x.key === key.toUpperCase() || x.id === key);
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

const now = () => new Date().toISOString();

export const memoryTemplateStore: TemplateStore = {
  async listTemplates(s, opts = {}) {
    if (isClientRole(s.user.role)) throw new ForbiddenError(TEMPLATES_INTERNAL);
    const all = memoryTemplates();
    return opts.includeArchived && s.user.role === 'admin' ? all : all.filter((t) => !t.archivedAt);
  },

  async createTemplate(s, input, ip) {
    requireAdmin(s, 'create templates');
    const tpl = prepareTemplate(input, memoryTemplates());
    const summary: TemplateSummary = {
      ...tpl,
      builtin: false,
      baseId: templateCreateSchema.parse(input).baseId,
      createdBy: s.user.id,
      createdAt: now(),
      archivedAt: null,
    };
    db().admin.templates.push(summary);
    writeAudit(s, 'template.create', 'template', summary.id, undefined, summary, ip);
    return summary;
  },

  async archiveTemplate(s, id, ip) {
    requireAdmin(s, 'archive templates');
    if (TEMPLATES.some((t) => t.id === id))
      throw new ForbiddenError('Built-in templates cannot be archived.');
    const t = db().admin.templates.find((x) => x.id === id);
    if (!t) throw new NotFoundError('Template not found');
    if (t.archivedAt) return;
    t.archivedAt = now();
    writeAudit(s, 'template.archive', 'template', t.id, undefined, { archivedAt: t.archivedAt }, ip);
  },

  async getWorkflow(s, projectKey) {
    const p = visibleProject(s, projectKey);
    return resolveWorkflow(db().admin.workflows[p.id]);
  },

  async updateWorkflow(s, projectKey, input, ip) {
    requireAdmin(s, 'configure workflows');
    const p = visibleProject(s, projectKey);
    const statuses = prepareWorkflow(input);
    const before = resolveWorkflow(db().admin.workflows[p.id]);
    db().admin.workflows[p.id] = statuses;
    writeAudit(s, 'workflow.update', 'project', p.id, before, statuses, ip);
    return statuses.map((x) => ({ ...x }));
  },
};

export const templateStore = (): TemplateStore =>
  isPostgresEnabled() ? postgresTemplateStore() : memoryTemplateStore;
