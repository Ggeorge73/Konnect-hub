import 'server-only';
import { NextResponse } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { errorStatus, NotFoundError, ValidationError } from '../data/errors';
import { getSession } from '../session';
import type { Session, Visibility } from '../domain/types';
import { contentTypeFor, uploadError, type AttachmentTarget } from '../domain/files';
import { attachmentStore } from '../data/attachments';
import { scanFile } from './scan';
import { downloadHeaders, fileStorage } from './storage';

/**
 * FILE-01 route helpers: multipart uploads (checked, scanned, then stored through the attachment
 * store) and authorised downloads (a 5-minute signed URL with Supabase, else the bytes streamed by
 * the route). A browser never receives a storage URL that outlives the permission check.
 */

/** Like handle() in lib/api.ts, for routes that answer with a file or a redirect. */
export async function fileRoute(fn: (session: Session) => Promise<Response>): Promise<Response> {
  try {
    return await fn(await getSession());
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError)
      return NextResponse.json({ error: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
    const status = errorStatus(e);
    if (status === 500) console.error(e);
    return NextResponse.json(
      { error: status === 500 ? 'Something went wrong.' : (e as Error).message },
      { status },
    );
  }
}

export interface CheckedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** Reads `file` from a multipart form: limits first (before reading the bytes), then the scan hook. */
export async function readCheckedFile(
  form: FormData,
  opts: { maxBytes?: number; types?: string[] } = {},
): Promise<CheckedFile> {
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new ValidationError('Choose a file to upload.');
  const err = uploadError({ name: file.name, size: file.size, type: file.type }, opts);
  if (err) throw new ValidationError(err);
  const type = contentTypeFor(file.name, file.type)!;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const scan = await scanFile({ name: file.name, type, bytes });
  if (!scan.clean)
    throw new ValidationError(`${file.name} was blocked by the virus scan: ${scan.reason ?? 'unsafe'}`);
  return { name: file.name, type, bytes };
}

const TARGETS: AttachmentTarget[] = ['work_item', 'raid', 'comment'];

/** POST /api/attachments body: file, entityType, entityId and (staff only) visibility. */
/** Parses a multipart upload; a non-form body is a client error (400), not a server crash. */
export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new ValidationError('Upload the file as multipart/form-data.');
  }
}

export async function uploadAttachment(session: Session, req: Request, ip?: string) {
  const form = await readForm(req);
  const entityType = String(form.get('entityType') ?? '') as AttachmentTarget;
  const entityId = String(form.get('entityId') ?? '');
  if (!TARGETS.includes(entityType) || !entityId)
    throw new ValidationError('Say what the file is attached to.');
  const v = form.get('visibility');
  const visibility: Visibility | undefined = v === 'shared' || v === 'internal' ? v : undefined;
  const f = await readCheckedFile(form);
  return attachmentStore().create(
    session,
    { entityType, entityId, visibility, fileName: f.name, mimeType: f.type, sizeBytes: f.bytes.byteLength },
    ({ bucket, storagePath }) => fileStorage().put(bucket, storagePath, f.bytes, f.type),
    ip,
  );
}

/** Serves stored bytes after the caller's permission check: a signed-URL redirect or the bytes. */
export async function serveStoredFile(
  loc: { bucket: string; storagePath: string },
  name: string,
  contentType: string,
  inline = false,
): Promise<Response> {
  const storage = fileStorage();
  const url = await storage.signedUrl(loc.bucket, loc.storagePath, name);
  if (url)
    return NextResponse.redirect(url, { status: 302, headers: { 'cache-control': 'private, no-store' } });
  const f = await storage.read(loc.bucket, loc.storagePath);
  if (!f) throw new NotFoundError('This file is no longer available.');
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: downloadHeaders(name, f.contentType || contentType, inline),
  });
}
