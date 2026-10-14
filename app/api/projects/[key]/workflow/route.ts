import { handle } from '@/lib/api';
import { templateStore } from '@/lib/data/templates-admin';
import { workflowSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ key: string }> };

/** GET: the board's column labels and WIP limits. PUT (Admin): rename columns, set WIP limits. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => templateStore().getWorkflow(session, (await params).key));
export const PUT = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    templateStore().updateWorkflow(
      session,
      (await params).key,
      workflowSchema.parse(await req.json()),
      requestIp(req),
    ),
  );
