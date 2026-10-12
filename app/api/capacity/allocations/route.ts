import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';
import { allocationSchema } from '@/lib/capacity-schemas';

/** PUT /api/capacity/allocations: set one person's hours on a project in one ISO week (0 clears). */
export const PUT = (req: Request) =>
  handle(async ({ session }) =>
    capacityStore().setAllocation(session, allocationSchema.parse(await req.json())),
  );
