import { handle } from '@/lib/api';
import { attachmentStore } from '@/lib/data/attachments';
import { fileStorage } from '@/lib/files/storage';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE: the uploader or an Admin removes a file (audited); the stored bytes go too. */
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    attachmentStore().remove(
      session,
      (await params).id,
      ({ bucket, storagePath }) => fileStorage().remove(bucket, storagePath),
      requestIp(req),
    ),
  );
