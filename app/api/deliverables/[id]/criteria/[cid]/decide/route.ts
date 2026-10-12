import { handle } from '@/lib/api';
import { decideCriterion } from '@/lib/data/deliverables';
import { clientIp } from '@/lib/domain/gates';
import { criterionDecisionSchema } from '@/lib/gate-schemas';
import { getReauthAt } from '@/lib/reauth';

/** Client acceptance of one criterion. Needs a re-auth in the last 15 minutes. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string; cid: string }> }) =>
  handle(async ({ session }) => {
    const { id, cid } = await params;
    return decideCriterion(session, id, cid, criterionDecisionSchema.parse(await req.json()), {
      ip: clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
      reauthAt: await getReauthAt(session.user.id),
    });
  });
