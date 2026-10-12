import { handle } from '@/lib/api';
import { getRaid, updateRaid } from '@/lib/data/raid';
import { raidPatchSchema } from '@/lib/raid-schemas';

type Ctx = { params: Promise<{ id: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getRaid(session, (await params).id));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    updateRaid(session, (await params).id, raidPatchSchema.parse(await req.json())),
  );
