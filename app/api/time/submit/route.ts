import { handle } from '@/lib/api';
import { submitWeek } from '@/lib/data/ledger';
import { isoWeekStart } from '@/lib/domain/ledger';
import { submitWeekSchema } from '@/lib/ledger-schemas';

/** "Submit week": moves the caller's draft entries of the ISO week to submitted. */
export const POST = (req: Request) =>
  handle(async ({ session }) => {
    const { week } = submitWeekSchema.parse(await req.json());
    return submitWeek(session, isoWeekStart(week));
  });
