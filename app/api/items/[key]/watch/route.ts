import { z } from 'zod';
import { handle } from '@/lib/api';
import { getWatch, setWatch } from '@/lib/data/notify';

type Ctx = { params: Promise<{ key: string }> };
const schema = z.object({ watching: z.boolean() });

/** GET: is the signed-in user watching this item, and how many people are. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) => {
    const { item } = await repo.getItem(session, (await params).key); // visibility check
    return getWatch(session, item.id);
  });

/** PUT { watching }: watch or unwatch an item the user can see. */
export const PUT = (req: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) => {
    const { item } = await repo.getItem(session, (await params).key);
    return setWatch(session, item.id, schema.parse(await req.json()).watching);
  });
