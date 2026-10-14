import { handle } from '@/lib/api';
import { listAudit } from '@/lib/data/audit';
import { auditQuerySchema } from '@/lib/ledger-schemas';

/** AUD-01: paginated, filtered audit log (Admin only). Read-only: there is no write route. */
export const GET = (req: Request) =>
  handle(async ({ session }) => {
    const q = auditQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return listAudit(session, {
      actorId: q.actor,
      actionPrefix: q.action,
      from: q.from,
      to: q.to,
      page: q.page,
      pageSize: q.pageSize,
    });
  });
