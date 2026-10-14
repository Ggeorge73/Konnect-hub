import type { Session, WorkItem } from '../domain/types';
import {
  canSeeField,
  customFieldPatchSchema,
  customFieldSchema,
  normaliseFieldValue,
  patchField,
  type CustomField,
  type CustomFieldInput,
  type CustomFieldPatch,
  type FieldValues,
} from '../domain/admin';
import { canEditItems, canSeeProject, canSeeVisibility } from '../domain/permissions';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { writeAudit } from './gates';
import { isPostgresEnabled } from './index';
import { requireAdmin } from './admin-rules';
import { postgresCustomFieldStore } from './custom-fields-postgres';

/**
 * Custom fields (ADM-01): text, number, date and select fields defined once for the workspace by
 * an Admin and filled in on work items by Konnector staff (item side panel, list columns).
 * Clients see shared fields on shared items only. Postgres: `custom_fields` and
 * `custom_field_values` (0017_portal_admin_files.sql).
 */
export interface CustomFieldStore {
  listFields(s: Session, opts?: { includeArchived?: boolean }): Promise<CustomField[]>;
  createField(s: Session, input: CustomFieldInput, ip?: string): Promise<CustomField>;
  updateField(s: Session, id: string, patch: CustomFieldPatch, ip?: string): Promise<CustomField>;
  getItemValues(s: Session, itemKey: string): Promise<FieldValues>;
  /** Sets (or, with null or '', clears) one value. Returns the item's visible values. */
  setItemValue(
    s: Session,
    itemKey: string,
    fieldId: string,
    value: string | number | null,
  ): Promise<FieldValues>;
  /** itemId -> values, for the list view's custom columns. */
  listProjectValues(s: Session, projectKey: string): Promise<Record<string, FieldValues>>;
}

export const CANNOT_EDIT_ITEM = 'You cannot edit this item.';

/** Shared by both stores: validates a value or throws a ValidationError. */
export function checkValue(field: CustomField, value: string | number | null) {
  if (field.archivedAt) throw new ValidationError(`${field.name} is archived.`);
  const r = normaliseFieldValue(field, value);
  if (!r.ok) throw new ValidationError(r.error);
  return r.value;
}

export function checkFieldInput(input: CustomFieldInput, existing: CustomField[], selfId?: string) {
  const v = customFieldSchema.parse(input);
  if (existing.some((f) => f.id !== selfId && !f.archivedAt && f.name.toLowerCase() === v.name.toLowerCase()))
    throw new ValidationError(`A field called ${v.name} already exists.`);
  return v;
}

export function applyPatch(f: CustomField, patch: CustomFieldPatch, existing: CustomField[]) {
  const p = customFieldPatchSchema.parse(patch);
  let next: CustomField;
  try {
    next = patchField(f, p, new Date().toISOString());
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  if (
    !next.archivedAt &&
    existing.some((x) => x.id !== f.id && !x.archivedAt && x.name.toLowerCase() === next.name.toLowerCase())
  )
    throw new ValidationError(`A field called ${next.name} already exists.`);
  return next;
}

const fields = () => db().admin.fields;

function visibleItem(s: Session, key: string): WorkItem {
  const d = db();
  const item = d.items.find((i) => i.key === key.toUpperCase() || i.id === key);
  const project = item && d.projects.find((p) => p.id === item.projectId);
  if (
    !item ||
    item.deletedAt ||
    !project ||
    !canSeeVisibility(s.user, item.visibility) ||
    !canSeeProject(s.user, project, d.members)
  )
    throw new NotFoundError('Item not found');
  return item;
}

function valuesOf(s: Session, itemId: string): FieldValues {
  const visible = new Set(
    fields()
      .filter((f) => canSeeField(s.user, f))
      .map((f) => f.id),
  );
  return Object.fromEntries(
    db()
      .admin.fieldValues.filter((v) => v.itemId === itemId && visible.has(v.fieldId))
      .map((v) => [v.fieldId, v.value]),
  );
}

export const memoryCustomFieldStore: CustomFieldStore = {
  async listFields(s, opts = {}) {
    return fields()
      .filter((f) => canSeeField(s.user, f))
      .filter((f) => !f.archivedAt || (opts.includeArchived && s.user.role === 'admin'))
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ ...f, options: [...f.options] }));
  },

  async createField(s, input, ip) {
    requireAdmin(s, 'define custom fields');
    const v = checkFieldInput(input, fields());
    const f: CustomField = {
      id: newId('cf'),
      ...v,
      position: Math.max(0, ...fields().map((x) => x.position)) + 1,
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };
    fields().push(f);
    writeAudit(s, 'custom_field.create', 'custom_field', f.id, undefined, f, ip);
    return { ...f };
  },

  async updateField(s, id, patch, ip) {
    requireAdmin(s, 'define custom fields');
    const f = fields().find((x) => x.id === id);
    if (!f) throw new NotFoundError('Field not found');
    const next = applyPatch(f, patch, fields());
    const before = { ...f };
    Object.assign(f, next);
    writeAudit(s, 'custom_field.update', 'custom_field', f.id, before, { ...f }, ip);
    return { ...f };
  },

  async getItemValues(s, itemKey) {
    return valuesOf(s, visibleItem(s, itemKey).id);
  },

  async setItemValue(s, itemKey, fieldId, value) {
    if (!canEditItems(s.user)) throw new ForbiddenError(CANNOT_EDIT_ITEM);
    const item = visibleItem(s, itemKey);
    const field = fields().find((f) => f.id === fieldId);
    if (!field) throw new NotFoundError('Field not found');
    const v = checkValue(field, value);
    const d = db();
    const list = d.admin.fieldValues;
    const i = list.findIndex((x) => x.itemId === item.id && x.fieldId === field.id);
    if (v === null) {
      if (i >= 0) list.splice(i, 1);
    } else if (i >= 0) list[i].value = v;
    else list.push({ projectId: item.projectId, itemId: item.id, fieldId: field.id, value: v });
    d.activity.push({
      id: newId('ac'),
      projectId: item.projectId,
      itemId: item.id,
      actorId: s.user.id,
      action: 'item.updated',
      detail: `${item.key}: ${field.name} updated`,
      at: new Date().toISOString(),
    });
    return valuesOf(s, item.id);
  },

  async listProjectValues(s, projectKey) {
    const d = db();
    const p = d.projects.find((x) => x.key === projectKey.toUpperCase() || x.id === projectKey);
    if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
    const items = new Set(
      d.items
        .filter((i) => i.projectId === p.id && !i.deletedAt && canSeeVisibility(s.user, i.visibility))
        .map((i) => i.id),
    );
    const out: Record<string, FieldValues> = {};
    for (const id of new Set(d.admin.fieldValues.filter((v) => items.has(v.itemId)).map((v) => v.itemId))) {
      const vals = valuesOf(s, id);
      if (Object.keys(vals).length) out[id] = vals;
    }
    return out;
  },
};

export const customFieldStore = (): CustomFieldStore =>
  isPostgresEnabled() ? postgresCustomFieldStore() : memoryCustomFieldStore;
