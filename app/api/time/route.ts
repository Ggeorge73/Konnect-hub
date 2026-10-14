import { handle } from '@/lib/api';
import { listWeek, logTime } from '@/lib/data/ledger';
import { isoWeekStart } from '@/lib/domain/ledger';
import { logTimeSchema } from '@/lib/ledger-schemas';
import { isoDay } from '@/lib/data/insight';

/** TIME-01: the caller's own time entries for an ISO week (?week=YYYY-MM-DD, any day of it). */
export const GET = (req: Request) =>
  handle(async ({ session }) => {
    const week = new URL(req.url).searchParams.get('week') ?? isoDay(new Date());
    return listWeek(session, isoWeekStart(/^\d{4}-\d{2}-\d{2}$/.test(week) ? week : isoDay(new Date())));
  });

/** TIME-01: log time on a work item (internal users; associates on assigned projects only). */
export const POST = (req: Request) =>
  handle(async ({ session }) => logTime(session, logTimeSchema.parse(await req.json())));
