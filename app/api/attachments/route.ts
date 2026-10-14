import { handle } from '@/lib/api';
import { attachmentStore } from '@/lib/data/attachments';
import { ValidationError } from '@/lib/data/errors';
import { uploadAttachment } from '@/lib/files/http';
import { requestIp } from '@/lib/export-http';

/** GET ?entityType=work_item|raid&entityId=: the files the caller may see (items include comment files). */
export const GET = (req: Request) =>
  handle(async ({ session }) => {
    const q = new URL(req.url).searchParams;
    const type = q.get('entityType');
    const id = q.get('entityId');
    if ((type !== 'work_item' && type !== 'raid') || !id)
      throw new ValidationError('entityType and entityId are required.');
    return attachmentStore().list(session, type, id);
  });

/** POST multipart: file, entityType (work_item | raid | comment), entityId, visibility. 25 MB max. */
export const POST = (req: Request) =>
  handle(async ({ session }) => uploadAttachment(session, req, requestIp(req)));
