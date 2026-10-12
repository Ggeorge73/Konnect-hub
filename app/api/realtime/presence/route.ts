import { z } from 'zod';
import { handle } from '@/lib/api';
import { heartbeat, leave, viewersOf } from '@/lib/realtime/presence';
import { publish } from '@/lib/realtime/bus';

const schema = z.object({ itemKey: z.string().min(1).max(40) });

/**
 * POST { itemKey } — presence heartbeat (every 15 s while an item panel is open). Records the
 * user on the item and returns the others viewing it (entries expire after 40 s).
 * DELETE { itemKey } — the panel closed.
 * The item must be visible to the caller, so presence never reveals internal items to clients.
 */
export const POST = (req: Request) =>
  handle(async ({ session, repo }) => {
    const { itemKey } = schema.parse(await req.json());
    const { item } = await repo.getItem(session, itemKey);
    const arriving = viewersOf(item.key).every((v) => v.userId !== session.user.id);
    heartbeat({ userId: session.user.id, itemKey: item.key, projectId: item.projectId });
    if (arriving)
      publish({
        kind: 'presence',
        projectId: item.projectId,
        itemId: item.id,
        itemKey: item.key,
        shared: item.visibility === 'shared',
        actorId: session.user.id,
      });
    return { viewers: viewersOf(item.key, session.user.id).map((v) => ({ userId: v.userId, at: v.at })) };
  });

export const DELETE = (req: Request) =>
  handle(async ({ session, repo }) => {
    const { itemKey } = schema.parse(await req.json());
    const { item } = await repo.getItem(session, itemKey);
    leave(session.user.id, item.key);
    publish({
      kind: 'presence',
      projectId: item.projectId,
      itemId: item.id,
      itemKey: item.key,
      shared: item.visibility === 'shared',
      actorId: session.user.id,
    });
    return { ok: true };
  });
