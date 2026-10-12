import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';

type Ctx = { params: Promise<{ key: string; userId: string }> };

/** DELETE /api/projects/:key/team/:userId: remove a member and their upcoming allocations. */
export const DELETE = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const { key, userId } = await params;
    await capacityStore().removeMember(session, key, userId);
  });
