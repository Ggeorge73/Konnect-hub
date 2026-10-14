import type { Profile, Visibility } from './types';
import { isClientRole } from './permissions';

/**
 * Attachments (FILE-01, spec 3.2 and 4 Files). Pure rules: size and type limits, who may upload
 * or delete, what visibility an upload gets, and where the bytes live (a private bucket per
 * client organization). Downloads always go through /api/attachments/:id/download.
 */

/** 25 MB per file (spec 4). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Logos are small images. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Supabase signed download URLs expire after 5 minutes. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Allowed content types and their extensions. No executables, archives, HTML or SVG (script risk). */
export const ALLOWED_TYPES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'text/plain': ['txt', 'log', 'md'],
  'text/csv': ['csv'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
};
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** The `accept` attribute for file inputs. */
export const ACCEPT_ATTR = Object.entries(ALLOWED_TYPES)
  .flatMap(([t, exts]) => [t, ...exts.map((e) => `.${e}`)])
  .join(',');

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

/**
 * The content type to store: the declared one when it is allowed and matches the extension,
 * else the one the extension implies (browsers send '' or octet-stream for some files).
 */
export function contentTypeFor(name: string, declared: string | null | undefined): string | null {
  const ext = extOf(name);
  const d = (declared ?? '').split(';')[0].trim().toLowerCase();
  if (d && ALLOWED_TYPES[d]?.includes(ext)) return d;
  return Object.entries(ALLOWED_TYPES).find(([, exts]) => exts.includes(ext))?.[0] ?? null;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a file can't be uploaded (null when it can). */
export function uploadError(
  f: { name: string; size: number; type?: string | null },
  opts: { maxBytes?: number; types?: string[] } = {},
): string | null {
  const max = opts.maxBytes ?? MAX_FILE_BYTES;
  if (!f.name.trim()) return 'The file needs a name.';
  if (f.size <= 0) return `${f.name} is empty.`;
  if (f.size > max) return `${f.name} is ${formatBytes(f.size)}; the limit is ${formatBytes(max)}.`;
  const type = contentTypeFor(f.name, f.type);
  if (!type || (opts.types && !opts.types.includes(type)))
    return `${f.name}: this file type is not allowed. Use PDF, images, text, CSV or Office documents.`;
  return null;
}

/** Attachment parents. A comment's files hang off the comment's own parent (item or RAID entry). */
export type AttachmentParent = 'work_item' | 'raid';
export type AttachmentTarget = AttachmentParent | 'comment';

export interface Attachment {
  id: string;
  projectId: string;
  entityType: AttachmentParent;
  entityId: string;
  /** Set when the file belongs to a comment on that entity. */
  commentId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  visibility: Visibility;
  createdAt: string;
}

/** Server-side record: where the bytes are. Never sent to the browser. */
export interface StoredAttachment extends Attachment {
  bucket: string;
  storagePath: string;
}

export const toPublicAttachment = ({ bucket: _b, storagePath: _p, ...a }: StoredAttachment): Attachment => a;

/** Viewers are read-only; everyone else who can see the parent may upload. */
export const canUpload = (user: Pick<Profile, 'role'>) => user.role !== 'client_viewer';

/** Uploaders delete their own files; Admins delete any (mirrors RLS attachments_delete). */
export const canDeleteAttachment = (user: Pick<Profile, 'id' | 'role'>, a: Pick<Attachment, 'uploadedBy'>) =>
  user.role === 'admin' || a.uploadedBy === user.id;

/**
 * The visibility an upload gets: client uploads are always shared; files on an internal comment
 * are always internal; otherwise what the uploader chose, internal by default.
 */
export function uploadVisibility(
  user: Pick<Profile, 'role'>,
  requested: Visibility | undefined,
  comment?: { visibility: Visibility } | null,
): Visibility {
  if (isClientRole(user.role)) return 'shared';
  if (comment?.visibility === 'internal') return 'internal';
  return requested ?? 'internal';
}

/** One private bucket per client organization (Supabase bucket names: a-z, 0-9, '-', '.'). */
export const bucketForOrg = (orgId: string) =>
  `kh-org-${orgId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 63);
/** Workspace and client logos. Private too: served through /api/orgs/:id/logo. */
export const BRANDING_BUCKET = 'kh-branding';

/** A file name safe to store and to send back: no paths, control characters or quotes. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:]+/g, '_').trim();
  if (!clean || clean === '.' || clean === '..') return 'file';
  if (clean.length <= 120) return clean;
  const ext = extOf(clean);
  return `${clean.slice(0, 110 - ext.length)}${ext ? `.${ext}` : ''}`;
}

export const storagePathFor = (projectId: string, entityId: string, attachmentId: string, name: string) =>
  `${projectId}/${entityId}/${attachmentId}-${safeFileName(name).replace(/\s+/g, '_')}`;

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(name: string, inline = false) {
  const safe = safeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/[\\%]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
