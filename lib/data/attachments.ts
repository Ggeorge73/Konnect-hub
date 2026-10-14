import type { Session, Visibility } from '../domain/types';
import {
  bucketForOrg,
  canDeleteAttachment,
  canUpload,
  contentTypeFor,
  storagePathFor,
  toPublicAttachment,
  uploadError,
  uploadVisibility,
  type Attachment,
  type AttachmentParent,
  type AttachmentTarget,
  type StoredAttachment,
} from '../domain/files';
import { canSeeProject, canSeeVisibility } from '../domain/permissions';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { writeAudit } from './gates';
import { isPostgresEnabled } from './index';
import { postgresAttachmentStore } from './attachments-postgres';

/**
 * Attachments on work items, comments and RAID entries (FILE-01). The store keeps the metadata
 * and enforces who may see, add or delete a file; the bytes go through `write` / `erase`
 * callbacks into lib/files/storage.ts (a private bucket per client org). Clients never see an
 * internal file, a file on an internal comment, or a file on an internal parent.
 * Postgres: `attachments` with the 0017 RLS policies.
 */
export interface AttachmentInput {
  entityType: AttachmentTarget;
  /** Item key or id, RAID entry id, or comment id. */
  entityId: string;
  visibility?: Visibility;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export type StorageCallback = (loc: { bucket: string; storagePath: string }) => Promise<void>;

export interface AttachmentStore {
  /** Files on an item (including its comments' files) or a RAID entry. */
  list(s: Session, entityType: AttachmentParent, entityId: string): Promise<Attachment[]>;
  /** One file with its storage location, after the visibility check (for the download route). */
  get(s: Session, id: string): Promise<StoredAttachment>;
  /** Checks, then `write`s the bytes, then records the file. Nothing is recorded if `write` fails. */
  create(s: Session, input: AttachmentInput, write: StorageCallback, ip?: string): Promise<Attachment>;
  remove(s: Session, id: string, erase?: StorageCallback, ip?: string): Promise<void>;
}

export const VIEWERS_READ_ONLY = 'Viewers cannot upload files.';
export const DELETE_REFUSED = 'Only the uploader or an Admin can delete this file.';
export const COMMENT_PARENTS = 'Files can be attached to comments on work items and RAID entries.';

/** Shared input check: size, type allow-list and the uploader's role. Returns the stored type. */
export function checkUpload(s: Session, input: AttachmentInput) {
  if (!canUpload(s.user)) throw new ForbiddenError(VIEWERS_READ_ONLY);
  const err = uploadError({ name: input.fileName, size: input.sizeBytes, type: input.mimeType });
  if (err) throw new ValidationError(err);
  return contentTypeFor(input.fileName, input.mimeType)!;
}

interface Parent {
  type: AttachmentParent;
  id: string;
  projectId: string;
  comment: { id: string; visibility: Visibility } | null;
}

function visibleProject(s: Session, projectId: string) {
  const d = db();
  const p = d.projects.find((x) => x.id === projectId);
  return p && canSeeProject(s.user, p, d.members) ? p : null;
}

function resolveParent(s: Session, type: AttachmentTarget, id: string): Parent {
  const d = db();
  if (type === 'comment') {
    const c = d.comments.find((x) => x.id === id);
    if (!c || !canSeeVisibility(s.user, c.visibility)) throw new NotFoundError('Comment not found');
    if (c.entityType !== 'work_item' && c.entityType !== 'raid') throw new ValidationError(COMMENT_PARENTS);
    return { ...resolveParent(s, c.entityType, c.entityId), comment: { id: c.id, visibility: c.visibility } };
  }
  if (type === 'work_item') {
    const item = d.items.find((i) => i.id === id || i.key === id.toUpperCase());
    if (
      !item ||
      item.deletedAt ||
      !canSeeVisibility(s.user, item.visibility) ||
      !visibleProject(s, item.projectId)
    )
      throw new NotFoundError('Item not found');
    return { type, id: item.id, projectId: item.projectId, comment: null };
  }
  const r = d.raid.find((x) => x.id === id);
  if (!r || !canSeeVisibility(s.user, r.visibility) || !visibleProject(s, r.projectId))
    throw new NotFoundError('RAID entry not found');
  return { type, id: r.id, projectId: r.projectId, comment: null };
}

/** The file is visible: its own visibility, its parent's, and (if any) its comment's. */
function visibleFile(s: Session, a: StoredAttachment) {
  if (!canSeeVisibility(s.user, a.visibility)) return false;
  try {
    resolveParent(s, a.entityType, a.entityId);
    if (a.commentId) resolveParent(s, 'comment', a.commentId);
    return true;
  } catch {
    return false;
  }
}

const files = () => db().admin.attachments;

export const memoryAttachmentStore: AttachmentStore = {
  async list(s, entityType, entityId) {
    const p = resolveParent(s, entityType, entityId);
    return files()
      .filter((a) => a.entityType === p.type && a.entityId === p.id && visibleFile(s, a))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toPublicAttachment);
  },

  async get(s, id) {
    const a = files().find((x) => x.id === id);
    if (!a || !visibleFile(s, a)) throw new NotFoundError('File not found');
    return { ...a };
  },

  async create(s, input, write, ip) {
    const mimeType = checkUpload(s, input);
    const p = resolveParent(s, input.entityType, input.entityId);
    const project = db().projects.find((x) => x.id === p.projectId)!;
    const id = newId('at');
    const a: StoredAttachment = {
      id,
      projectId: p.projectId,
      entityType: p.type,
      entityId: p.id,
      commentId: p.comment?.id ?? null,
      fileName: input.fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      uploadedBy: s.user.id,
      visibility: uploadVisibility(s.user, input.visibility, p.comment),
      createdAt: new Date().toISOString(),
      bucket: bucketForOrg(project.clientOrgId),
      storagePath: storagePathFor(p.projectId, p.id, id, input.fileName),
    };
    await write({ bucket: a.bucket, storagePath: a.storagePath });
    files().push(a);
    writeAudit(s, 'attachment.upload', 'attachment', a.id, undefined, toPublicAttachment(a), ip);
    return toPublicAttachment(a);
  },

  async remove(s, id, erase, ip) {
    const a = await this.get(s, id);
    if (!canDeleteAttachment(s.user, a)) throw new ForbiddenError(DELETE_REFUSED);
    const list = files();
    list.splice(
      list.findIndex((x) => x.id === a.id),
      1,
    );
    await erase?.({ bucket: a.bucket, storagePath: a.storagePath });
    writeAudit(s, 'attachment.delete', 'attachment', a.id, toPublicAttachment(a), undefined, ip);
  },
};

export const attachmentStore = (): AttachmentStore =>
  isPostgresEnabled() ? postgresAttachmentStore() : memoryAttachmentStore;
