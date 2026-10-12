import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';

/** GET /api/capacity/grid?from=YYYY-MM-DD: person × ISO week allocation grid (12 weeks). */
export const GET = (req: Request) =>
  handle(({ session }) =>
    capacityStore().getGrid(session, { from: new URL(req.url).searchParams.get('from') ?? undefined }),
  );
