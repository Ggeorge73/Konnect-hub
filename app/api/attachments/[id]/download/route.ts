import { attachmentStore } from '@/lib/data/attachments';
import { fileRoute, serveStoredFile } from '@/lib/files/http';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/**
 * GET: the only way to download an attachment. The store checks the caller may see the file
 * (visibility, parent, comment, tenant); then Supabase answers with a 5-minute signed URL, or the
 * demo / local backends stream the bytes. A hidden or unknown file is a 404 either way.
 */
export const GET = (_: Request, { params }: Ctx) =>
  fileRoute(async (session) => {
    const a = await attachmentStore().get(session, (await params).id);
    return serveStoredFile(a, a.fileName, a.mimeType);
  });
