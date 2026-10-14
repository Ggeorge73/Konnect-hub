import { handle } from '@/lib/api';
import { itemTime } from '@/lib/data/ledger';

/** Logged time on an item for the side panel: total hours and the caller's own entries. Internal only. */
export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => itemTime(session, (await params).key));
