import { handle } from '@/lib/api';
import { createRaid, listRaid } from '@/lib/data/raid';
import { createRaidSchema } from '@/lib/raid-schemas';

/** GET /api/raid?project=KEY or ?item=KEY: RAID entries the caller may see. */
export const GET = (req: Request) =>
  handle(({ session }) => {
    const sp = new URL(req.url).searchParams;
    return listRaid(session, {
      projectId: sp.get('project') ?? undefined,
      itemId: sp.get('item') ?? undefined,
    });
  });

export const POST = (req: Request) =>
  handle(async ({ session }) => createRaid(session, createRaidSchema.parse(await req.json())));
