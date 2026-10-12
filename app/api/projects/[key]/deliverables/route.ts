import { handle } from '@/lib/api';
import { createDeliverable, listDeliverables } from '@/lib/data/deliverables';
import { deliverableCreateSchema } from '@/lib/gate-schemas';

type Ctx = { params: Promise<{ key: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => listDeliverables(session, (await params).key));
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    createDeliverable(session, (await params).key, deliverableCreateSchema.parse(await req.json())),
  );
