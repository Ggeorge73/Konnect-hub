import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';
import { previewSchema } from '@/lib/capacity-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** POST /api/projects/:key/team/preview: over-allocation warnings and refusal, without saving. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    capacityStore().previewAssignment(session, (await params).key, previewSchema.parse(await req.json())),
  );
