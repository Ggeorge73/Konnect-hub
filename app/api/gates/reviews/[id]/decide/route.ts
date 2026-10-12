import { handle } from '@/lib/api';
import { decideGate } from '@/lib/data/gates';
import { clientIp } from '@/lib/domain/gates';
import { decisionSchema } from '@/lib/gate-schemas';
import { getReauthAt } from '@/lib/reauth';

/** Client Sponsor decision. 403 for anyone else; 401 `reauth_required` without a re-auth in the last 15 min. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) => {
    const input = decisionSchema.parse(await req.json());
    return decideGate(session, (await params).id, input, {
      ip: clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip')),
      reauthAt: await getReauthAt(session.user.id),
    });
  });
