import { handle } from '@/lib/api';
import { templateStore } from '@/lib/data/templates-admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE archives a custom template (built-ins can't be archived; projects keep their template). */
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => templateStore().archiveTemplate(session, (await params).id, requestIp(req)));
