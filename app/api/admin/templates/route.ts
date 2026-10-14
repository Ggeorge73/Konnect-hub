import { handle } from '@/lib/api';
import { templateStore } from '@/lib/data/templates-admin';
import { templateCreateSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

/** POST: an Admin creates a custom template from an existing one (exit criteria, RAID categories). */
export const POST = (req: Request) =>
  handle(async ({ session }) =>
    templateStore().createTemplate(session, templateCreateSchema.parse(await req.json()), requestIp(req)),
  );
