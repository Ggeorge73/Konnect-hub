import { handle } from '@/lib/api';
import { decideTime, listApprovals } from '@/lib/data/ledger';
import { groupApprovals } from '@/lib/domain/ledger';
import { decideTimeSchema } from '@/lib/ledger-schemas';

/** Submitted time on the caller's projects (Lead: projects they lead; Admin: all), by person and week. */
export const GET = () => handle(async ({ session }) => groupApprovals(await listApprovals(session)));

/** Approve or reject submitted entries (a reason is required to reject). Approved time is locked. */
export const POST = (req: Request) =>
  handle(async ({ session }) => {
    const { ids, decision, reason } = decideTimeSchema.parse(await req.json());
    return decideTime(session, ids, decision, reason);
  });
