import { z } from 'zod';
import type { ItemStatus, Organization, Profile, Role, Visibility } from './types';
import { isClientRole, ROLE_LABEL } from './permissions';
import { splitEmails } from './onboarding';
import { DEFAULT_STATUSES } from './workflow';
import { GATE_NAMES, type ProjectTemplate } from './templates';

/**
 * Admin console (ADM-01, spec 3.11). Pure rules only: who may hold which role, invites with an
 * org, custom project templates, per-project workflow labels and WIP limits, and custom fields.
 * Both data stores (lib/data/admin*.ts) and the 0017 migration enforce the same rules.
 */

// ---------------------------------------------------------------------------
// Users and roles
// ---------------------------------------------------------------------------
export const INTERNAL_ROLES = ['admin', 'delivery_lead', 'team_member', 'associate'] as const;
export const CLIENT_ROLES = ['client_sponsor', 'client_member', 'client_viewer'] as const;
export const ALL_ROLES = [...INTERNAL_ROLES, ...CLIENT_ROLES] as const;

/** Konnector users hold Konnector roles; client users hold client roles. Never mixed. */
export const rolesForOrg = (org: Pick<Organization, 'type'>): readonly Role[] =>
  org.type === 'internal' ? INTERNAL_ROLES : CLIENT_ROLES;

export const canAdminister = (user: Pick<Profile, 'role'>) => user.role === 'admin';

/** A user as the Admin console lists them. */
export interface AdminUser extends Profile {
  orgName: string;
  orgType: Organization['type'];
  deactivatedAt: string | null;
}

/** Why an Admin may not give `target` the `role` (null when allowed). */
export function roleChangeError(
  actor: Pick<Profile, 'id' | 'role'>,
  target: Pick<Profile, 'id'>,
  org: Pick<Organization, 'type' | 'name'>,
  role: Role,
): string | null {
  if (!canAdminister(actor)) return 'Only Admins can change roles.';
  if (actor.id === target.id) return 'You cannot change your own role. Ask another Admin.';
  if (!rolesForOrg(org).includes(role)) return `${ROLE_LABEL[role]} is not a role for ${org.name} users.`;
  return null;
}

/** Why an Admin may not (de)activate `target` (null when allowed). */
export function deactivateError(actor: Pick<Profile, 'id' | 'role'>, target: Pick<Profile, 'id'>) {
  if (!canAdminister(actor)) return 'Only Admins can deactivate users.';
  if (actor.id === target.id) return 'You cannot deactivate yourself. Ask another Admin.';
  return null;
}

export const roleSchema = z.enum(ALL_ROLES);
export const userPatchSchema = z
  .object({ role: roleSchema.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Nothing to change');
export type UserPatch = z.infer<typeof userPatchSchema>;

// ---------------------------------------------------------------------------
// Invites (by email, with a role and an org)
// ---------------------------------------------------------------------------
export interface AdminInvite {
  id: string;
  email: string;
  role: Role;
  /** The organization the person joins (Konnector for staff). */
  orgId: string;
  status: 'pending' | 'sent';
  invitedBy: string;
  createdAt: string;
  lastSentAt: string | null;
  sentCount: number;
}

const email = z.string().email();

export const adminInviteSchema = z
  .object({
    emails: z.string(),
    role: roleSchema,
    orgId: z.string().min(1, 'Choose an organization'),
  })
  .superRefine((v, ctx) => {
    const list = splitEmails(v.emails);
    if (list.length === 0)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Add at least one email' });
    const bad = list.filter((e) => !email.safeParse(e).success);
    if (bad.length)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: `Not an email address: ${bad.join(', ')}` });
    if (list.length > 50)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Invite up to 50 at a time' });
  });
export type AdminInviteInput = z.input<typeof adminInviteSchema>;

/** Why this role can't be offered to people joining `org` (null when it can). */
export function inviteRoleError(org: Pick<Organization, 'type' | 'name'> | undefined, role: Role) {
  if (!org) return 'Unknown organization.';
  if (!rolesForOrg(org).includes(role)) return `${ROLE_LABEL[role]} is not a role for ${org.name} users.`;
  return null;
}

/** "ada.okafor@x.com" -> "Ada Okafor": a starting display name for an invited profile. */
export function nameFromEmail(address: string) {
  const local = address.split('@')[0] ?? address;
  const words = local.split(/[._-]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : address;
}

// ---------------------------------------------------------------------------
// Client orgs
// ---------------------------------------------------------------------------
export interface AdminOrg extends Organization {
  userCount: number;
  projectCount: number;
}

// ---------------------------------------------------------------------------
// Project templates
// ---------------------------------------------------------------------------
export interface TemplateSummary extends ProjectTemplate {
  builtin: boolean;
  baseId: string | null;
  createdBy: string | null;
  createdAt: string | null;
  /** Archived custom templates can no longer start projects; existing projects keep them. */
  archivedAt: string | null;
}

/** The built-in templates as summaries. */
export const builtinSummaries = (templates: ProjectTemplate[]): TemplateSummary[] =>
  templates.map((t) => ({
    ...t,
    builtin: true,
    baseId: null,
    createdBy: null,
    createdAt: null,
    archivedAt: null,
  }));

const criterionText = z.string().trim().min(2, 'Criteria need at least 2 characters').max(200);

export const templateCreateSchema = z.object({
  baseId: z.string().min(1, 'Choose a template to start from'),
  name: z.string().trim().min(3, 'Name needs at least 3 characters').max(120, 'Keep the name under 120'),
  description: z.string().trim().max(500).default(''),
  phases: z
    .array(
      z.object({
        gate: z.number().int().min(1).max(5),
        criteria: z
          .array(criterionText)
          .min(1, 'Each gate needs at least one exit criterion')
          .max(12, 'Up to 12 criteria per gate'),
      }),
    )
    .length(5, 'A template has exactly five gates'),
  raidCategories: z
    .array(z.string().trim().min(2, 'Categories need at least 2 characters').max(40))
    .min(1, 'Add at least one RAID category')
    .max(15, 'Up to 15 RAID categories'),
});
export type TemplateCreateInput = z.input<typeof templateCreateSchema>;

const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** A url-safe id for a new custom template, unique among `taken`. */
export function templateIdFor(name: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'template';
  let id = `custom-${slug}`;
  for (let n = 2; used.has(id); n++) id = `custom-${slug}-${n}`;
  return id;
}

/**
 * A custom template made from `base`: the five gates keep their fixed names; the Admin edits the
 * exit criteria and RAID categories. Throws a readable message when the input breaks a rule.
 */
export function buildCustomTemplate(
  base: ProjectTemplate,
  input: z.output<typeof templateCreateSchema>,
  id: string,
): ProjectTemplate {
  const gates = new Set(input.phases.map((p) => p.gate));
  if (gates.size !== 5) throw new Error('Each of the five gates must appear once.');
  return {
    id,
    name: input.name.trim(),
    description: input.description.trim() || `Based on ${base.name}.`,
    phases: [...input.phases]
      .sort((a, b) => a.gate - b.gate)
      .map((p) => ({
        gate: p.gate as 1 | 2 | 3 | 4 | 5,
        name: GATE_NAMES[p.gate as 1 | 2 | 3 | 4 | 5],
        criteria: dedupe(p.criteria.map((c) => c.trim())),
      })),
    raidCategories: dedupe(input.raidCategories.map((c) => c.trim())),
  };
}

// ---------------------------------------------------------------------------
// Workflow: per-project status labels and WIP limits
// ---------------------------------------------------------------------------
export interface WorkflowStatus {
  id: ItemStatus;
  label: string;
  wipLimit?: number;
}

export const ACCEPTED_LOCKED =
  'Accepted is fixed: it cannot be renamed, limited or removed, and only the client can set it.';

export const workflowSchema = z.object({
  statuses: z.array(
    z.object({
      id: z.enum(['backlog', 'ready', 'in_progress', 'in_review', 'client_review', 'done', 'accepted']),
      label: z.string().trim().min(1, 'Every column needs a name').max(40, 'Keep column names under 40'),
      wipLimit: z.number().int().min(1, 'WIP limits start at 1').max(999).nullable().optional(),
    }),
  ),
});
export type WorkflowInput = z.input<typeof workflowSchema>;

/**
 * Validates an edited workflow: the seven statuses stay, in their order (the status enum and the
 * Accepted rule are fixed); only labels and WIP limits change. Returns the cleaned list or an error.
 */
export function normaliseWorkflow(
  statuses: z.output<typeof workflowSchema>['statuses'],
): { ok: true; statuses: WorkflowStatus[] } | { ok: false; error: string } {
  const ids = statuses.map((s) => s.id);
  if (!ids.includes('accepted')) return { ok: false, error: ACCEPTED_LOCKED };
  if (ids.length !== DEFAULT_STATUSES.length || ids.some((id, i) => id !== DEFAULT_STATUSES[i].id))
    return { ok: false, error: 'Columns cannot be added, removed or reordered; rename them instead.' };
  const seen = new Set<string>();
  const out: WorkflowStatus[] = [];
  for (const s of statuses) {
    const label = s.label.trim();
    if (s.id === 'accepted' && (label !== 'Accepted' || s.wipLimit != null))
      return { ok: false, error: ACCEPTED_LOCKED };
    const k = label.toLowerCase();
    if (seen.has(k)) return { ok: false, error: `Two columns are called ${label}.` };
    seen.add(k);
    out.push(s.wipLimit != null ? { id: s.id, label, wipLimit: s.wipLimit } : { id: s.id, label });
  }
  return { ok: true, statuses: out };
}

/** The workflow a project uses: its saved one, or the default. */
export const resolveWorkflow = (stored: WorkflowStatus[] | null | undefined): WorkflowStatus[] =>
  stored?.length ? stored : DEFAULT_STATUSES.map((s) => ({ ...s }));

export const statusLabels = (statuses: WorkflowStatus[]) =>
  Object.fromEntries(statuses.map((s) => [s.id, s.label])) as Record<ItemStatus, string>;

// ---------------------------------------------------------------------------
// Custom fields (workspace-wide; values per work item)
// ---------------------------------------------------------------------------
export const FIELD_KINDS = ['text', 'number', 'date', 'select'] as const;
export type CustomFieldKind = (typeof FIELD_KINDS)[number];
export const FIELD_KIND_LABEL: Record<CustomFieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Select',
};

export interface CustomField {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: string[];
  /** Shared fields (and their values on shared items) show in the client portal. */
  visibility: Visibility;
  position: number;
  archivedAt: string | null;
  createdAt: string;
}

/** fieldId -> value (text; numbers and dates in canonical form). */
export type FieldValues = Record<string, string>;

const optionList = z.array(z.string().trim().min(1).max(60)).max(50, 'Up to 50 options');

export const customFieldSchema = z
  .object({
    name: z.string().trim().min(2, 'Name needs at least 2 characters').max(60, 'Keep the name under 60'),
    kind: z.enum(FIELD_KINDS),
    options: optionList.default([]),
    visibility: z.enum(['internal', 'shared']).default('internal'),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'select' && dedupe(v.options).length === 0)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'A select field needs options' });
  })
  .transform((v) => ({ ...v, options: v.kind === 'select' ? dedupe(v.options) : [] }));
export type CustomFieldInput = z.input<typeof customFieldSchema>;

export const customFieldPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    options: optionList.optional(),
    visibility: z.enum(['internal', 'shared']).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type CustomFieldPatch = z.infer<typeof customFieldPatchSchema>;

/** Applies a patch; the kind never changes. Throws a readable message when invalid. */
export function patchField(f: CustomField, p: CustomFieldPatch, now: string): CustomField {
  const options = p.options ? dedupe(p.options) : f.options;
  if (f.kind === 'select' && options.length === 0) throw new Error('A select field needs options');
  return {
    ...f,
    name: p.name?.trim() ?? f.name,
    options: f.kind === 'select' ? options : [],
    visibility: p.visibility ?? f.visibility,
    archivedAt: p.archived === undefined ? f.archivedAt : p.archived ? (f.archivedAt ?? now) : null,
  };
}

export const fieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
});

/**
 * Checks and normalises a value for a field. Null or empty clears it. Numbers are stored in
 * canonical decimal form, dates as YYYY-MM-DD, select values must be one of the options.
 */
export function normaliseFieldValue(
  field: Pick<CustomField, 'kind' | 'options' | 'name'>,
  raw: string | number | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === ''))
    return { ok: true, value: null };
  const text = String(raw).trim();
  switch (field.kind) {
    case 'text':
      return text.length > 500
        ? { ok: false, error: `${field.name}: keep it under 500 characters` }
        : { ok: true, value: text };
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(text);
      if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(n))
        return { ok: false, error: `${field.name} must be a number` };
      return { ok: true, value: String(n) };
    }
    case 'date': {
      const d = new Date(`${text}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        Number.isNaN(d.getTime()) ||
        d.toISOString().slice(0, 10) !== text
      )
        return { ok: false, error: `${field.name} must be a date (YYYY-MM-DD)` };
      return { ok: true, value: text };
    }
    case 'select':
      return field.options.includes(text)
        ? { ok: true, value: text }
        : { ok: false, error: `${field.name} must be one of: ${field.options.join(', ')}` };
  }
}

/** Clients see shared, active fields only. */
export const canSeeField = (user: Pick<Profile, 'role'>, f: Pick<CustomField, 'visibility' | 'archivedAt'>) =>
  !isClientRole(user.role) || (f.visibility === 'shared' && !f.archivedAt);
