import { handle } from '@/lib/api';
import { decideItem } from '@/lib/integration/service';
import { decisionSchema } from '@/lib/domain/crm';
import { clientIp } from '@/lib/domain/gates';
import { getReauthAt } from '@/lib/reauth';

/**
 * POST /api/portal/review/:id/decide — accept (name, title and a re-auth in the last 15 minutes),
 * request changes (note required) or decline. Records email, time and IP; tells the CRM.
 */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) => {
    const id = decodeURIComponent((await params).id);
    return decideItem(session, id, decisionSchema.parse(await req.json()), {
      ip: clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')) ?? null,
      reauthAt: await getReauthAt(session.user.id),
    });
  });
