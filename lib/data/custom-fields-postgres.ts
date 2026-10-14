import type { Session } from '../domain/types';
import type { CustomField, FieldValues } from '../domain/admin';
import { canEditItems } from '../domain/permissions';
import type { CustomFieldStore } from './custom-fields';
import { applyPatch, CANNOT_EDIT_ITEM, checkFieldInput, checkValue, forViewer } from './custom-fields';
import {
  asUser,
  audit,
  findItem,
  findProject,
  getSql,
  isUuid,
  logActivity,
  textArray,
  type Row,
  type Sql,
  type Tx,
} from './postgres';
import { withClientIp } from './admin-postgres';
import { ForbiddenError, NotFoundError } from './errors';
import { requireAdmin } from './admin-rules';

const toField = (r: Row): CustomField => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  options: r.options ?? [],
  visibility: r.visibility,
  position: r.position,
  archivedAt: r.archived_at ?? null,
  createdAt: r.created_at,
});

/**
 * Custom fields on Postgres + RLS (0017). Clients only ever receive shared fields and values on
 * shared items: the policies hide the rest, so nothing here re-filters by role.
 */
export function createPostgresCustomFieldStore(sql: Sql): CustomFieldStore {
  const run = <T>(s: Session, ip: string | undefined, fn: (tx: Tx) => Promise<T>) =>
    asUser(sql, s.user.id, async (tx) => {
      await withClientIp(tx, ip);
      return fn(tx);
    });

  const allFields = async (tx: Tx) =>
    (await tx`select * from public.custom_fields order by position, created_at`).map(toField);

  const values = async (tx: Tx, itemId: string): Promise<FieldValues> =>
    Object.fromEntries(
      (await tx`select field_id, value from public.custom_field_values where item_id = ${itemId}`).map(
        (r) => [r.field_id, r.value],
      ),
    );

  return {
    async listFields(s, opts = {}) {
      return run(s, undefined, async (tx) =>
        (await allFields(tx))
          .filter((f) => !f.archivedAt || (opts.includeArchived && s.user.role === 'admin'))
          .map((f) => forViewer(s.user, f)),
      );
    },

    async createField(s, input, ip) {
      requireAdmin(s, 'define custom fields');
      return run(s, ip, async (tx) => {
        const v = checkFieldInput(input, await allFields(tx));
        const [r] = await tx`
          insert into public.custom_fields (name, kind, options, visibility, position, created_by)
          values (${v.name}, ${v.kind}, ${textArray(v.options)}::text[], ${v.visibility},
                  (select coalesce(max(position), 0) + 1 from public.custom_fields), ${s.user.id})
          returning *`;
        const f = toField(r);
        await audit(tx, s, null, 'custom_field.create', 'custom_field', f.id, undefined, f);
        return f;
      });
    },

    async updateField(s, id, patch, ip) {
      requireAdmin(s, 'define custom fields');
      return run(s, ip, async (tx) => {
        const list = await allFields(tx);
        const f = isUuid(id) ? list.find((x) => x.id === id) : undefined;
        if (!f) throw new NotFoundError('Field not found');
        const next = applyPatch(f, patch, list);
        const [r] = await tx`
          update public.custom_fields
          set name = ${next.name}, options = ${textArray(next.options)}::text[], visibility = ${next.visibility},
              archived_at = ${next.archivedAt}::timestamptz
          where id = ${f.id} returning *`;
        const out = toField(r);
        await audit(tx, s, null, 'custom_field.update', 'custom_field', f.id, f, out);
        return out;
      });
    },

    async getItemValues(s, itemKey) {
      return run(s, undefined, async (tx) => values(tx, (await findItem(tx, itemKey)).id));
    },

    async setItemValue(s, itemKey, fieldId, value) {
      if (!canEditItems(s.user)) throw new ForbiddenError(CANNOT_EDIT_ITEM);
      return run(s, undefined, async (tx) => {
        const item = await findItem(tx, itemKey);
        const [fr] = isUuid(fieldId)
          ? await tx`select * from public.custom_fields where id = ${fieldId}`
          : [];
        if (!fr) throw new NotFoundError('Field not found');
        const field = toField(fr);
        const v = checkValue(field, value);
        if (v === null)
          await tx`delete from public.custom_field_values where item_id = ${item.id} and field_id = ${field.id}`;
        else
          await tx`
            insert into public.custom_field_values (project_id, item_id, field_id, value, updated_by)
            values (${item.projectId}, ${item.id}, ${field.id}, ${v}, ${s.user.id})
            on conflict (item_id, field_id) do update
              set value = excluded.value, updated_by = excluded.updated_by`;
        await logActivity(
          tx,
          s,
          item.projectId,
          'item.updated',
          `${item.key}: ${field.name} updated`,
          item.visibility,
          item.id,
        );
        return values(tx, item.id);
      });
    },

    async listProjectValues(s, projectKey) {
      return run(s, undefined, async (tx) => {
        const p = await findProject(tx, projectKey);
        const out: Record<string, FieldValues> = {};
        for (const r of await tx`
          select item_id, field_id, value from public.custom_field_values where project_id = ${p.id}`)
          (out[r.item_id] ??= {})[r.field_id] = r.value;
        return out;
      });
    },
  };
}

let store: CustomFieldStore | undefined;
export const postgresCustomFieldStore = (): CustomFieldStore =>
  (store ??= createPostgresCustomFieldStore(getSql()));
