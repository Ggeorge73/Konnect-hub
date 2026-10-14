import { randomUUID } from 'node:crypto';
import type { Session, Visibility } from '../domain/types';
import {
  bucketForOrg,
  canDeleteAttachment,
  storagePathFor,
  toPublicAttachment,
  uploadVisibility,
  type AttachmentParent,
  type AttachmentTarget,
  type StoredAttachment,
} from '../domain/files';
import type { AttachmentStore } from './attachments';
import { checkUpload, COMMENT_PARENTS, DELETE_REFUSED } from './attachments';
import { asUser, audit, findItem, getSql, isUuid, type Row, type Sql, type Tx } from './postgres';
import { withClientIp } from './admin-postgres';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';

const toStored = (r: Row): StoredAttachment => ({
  id: r.id,
  projectId: r.project_id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  commentId: r.comment_id ?? null,
  fileName: r.file_name,
  mimeType: r.mime_type ?? 'application/octet-stream',
  sizeBytes: Number(r.size_bytes ?? 0),
  uploadedBy: r.uploaded_by,
  visibility: r.visibility,
  createdAt: r.created_at,
  // Seeded rows predate the bucket column: they live in their client org's bucket.
  bucket: r.bucket ?? bucketForOrg(r.client_org_id),
  storagePath: r.storage_path,
});

interface Parent {
  type: AttachmentParent;
  id: string;
  projectId: string;
  comment: { id: string; visibility: Visibility } | null;
}

/**
 * Attachments on Postgres + RLS (0017). The attachments policies decide what a caller sees and may
 * insert or delete (clients: shared files on shared parents, never on internal comments); the
 * parent lookups below go through the caller's RLS too, so a hidden parent is "not found".
 */
export function createPostgresAttachmentStore(sql: Sql): AttachmentStore {
  const run = <T>(s: Session, ip: string | undefined, fn: (tx: Tx) => Promise<T>) =>
    asUser(sql, s.user.id, async (tx) => {
      await withClientIp(tx, ip);
      return fn(tx);
    });

  async function parent(tx: Tx, type: AttachmentTarget, id: string): Promise<Parent> {
    if (type === 'work_item') {
      const item = await findItem(tx, id);
      return { type, id: item.id, projectId: item.projectId, comment: null };
    }
    if (type === 'raid') {
      const [r] = isUuid(id) ? await tx`select id, project_id from public.raid_entries where id = ${id}` : [];
      if (!r) throw new NotFoundError('RAID entry not found');
      return { type, id: r.id, projectId: r.project_id, comment: null };
    }
    const [c] = isUuid(id)
      ? await tx`select id, entity_type, entity_id, visibility from public.comments where id = ${id}`
      : [];
    if (!c) throw new NotFoundError('Comment not found');
    if (c.entity_type !== 'work_item' && c.entity_type !== 'raid') throw new ValidationError(COMMENT_PARENTS);
    return {
      ...(await parent(tx, c.entity_type, c.entity_id)),
      comment: { id: c.id, visibility: c.visibility },
    };
  }

  async function one(tx: Tx, id: string): Promise<StoredAttachment> {
    const [r] = isUuid(id)
      ? await tx`
          select a.*, p.client_org_id from public.attachments a
          join public.projects p on p.id = a.project_id
          where a.id = ${id}`
      : [];
    if (!r) throw new NotFoundError('File not found');
    return toStored(r);
  }

  return {
    async list(s, entityType, entityId) {
      return run(s, undefined, async (tx) => {
        const p = await parent(tx, entityType, entityId);
        const rows = await tx`
          select a.*, pr.client_org_id from public.attachments a
          join public.projects pr on pr.id = a.project_id
          where a.entity_type = ${p.type} and a.entity_id = ${p.id}
          order by a.created_at, a.id`;
        return rows.map((r) => toPublicAttachment(toStored(r)));
      });
    },

    async get(s, id) {
      return run(s, undefined, (tx) => one(tx, id));
    },

    async create(s, input, write, ip) {
      const mimeType = checkUpload(s, input);
      return run(s, ip, async (tx) => {
        const p = await parent(tx, input.entityType, input.entityId);
        const [project] = await tx`select client_org_id from public.projects where id = ${p.projectId}`;
        if (!project) throw new NotFoundError('Project not found');
        const id = randomUUID();
        const bucket = bucketForOrg(project.client_org_id);
        const storagePath = storagePathFor(p.projectId, p.id, id, input.fileName);
        // RLS decides whether this caller may attach here; the 0017 trigger makes files on an
        // internal comment internal. The bytes are written before commit: a failed upload rolls back.
        const [r] = await tx`
          insert into public.attachments (id, project_id, entity_type, entity_id, comment_id, file_name,
            storage_path, mime_type, size_bytes, uploaded_by, visibility, bucket)
          values (${id}, ${p.projectId}, ${p.type}, ${p.id}, ${p.comment?.id ?? null}, ${input.fileName},
            ${storagePath}, ${mimeType}, ${input.sizeBytes}, ${s.user.id},
            ${uploadVisibility(s.user, input.visibility, p.comment)}, ${bucket})
          returning *`;
        await write({ bucket, storagePath });
        const out = toPublicAttachment(toStored({ ...r, client_org_id: project.client_org_id }));
        await audit(tx, s, p.projectId, 'attachment.upload', 'attachment', id, undefined, out);
        return out;
      });
    },

    async remove(s, id, erase, ip) {
      return run(s, ip, async (tx) => {
        const a = await one(tx, id);
        if (!canDeleteAttachment(s.user, a)) throw new ForbiddenError(DELETE_REFUSED);
        const gone = await tx`delete from public.attachments where id = ${a.id} returning id`;
        if (!gone.length) throw new ForbiddenError(DELETE_REFUSED);
        await audit(tx, s, a.projectId, 'attachment.delete', 'attachment', a.id, toPublicAttachment(a));
        await erase?.({ bucket: a.bucket, storagePath: a.storagePath });
      });
    },
  };
}

let store: AttachmentStore | undefined;
export const postgresAttachmentStore = (): AttachmentStore =>
  (store ??= createPostgresAttachmentStore(getSql()));
