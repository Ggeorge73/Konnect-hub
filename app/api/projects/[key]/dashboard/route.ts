import { handle } from '@/lib/api';
import { getDashboard, overrideRag, setShareBudget } from '@/lib/data/insight';
import { clientIp } from '@/lib/domain/gates';
import { dashboardPatchSchema } from '@/lib/insight-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** DASH-01 executive one-pager, redacted per role (clients get the client-safe variant). */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getDashboard(session, (await params).key));

/** Lead/Admin: override the RAG (reason required) and/or share the budget view. Both audited. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const key = (await params).key;
    const patch = dashboardPatchSchema.parse(await req.json());
    const ip = clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'));
    if (patch.shareBudget !== undefined) await setShareBudget(session, key, patch.shareBudget, ip);
    if (patch.rag) await overrideRag(session, key, { rag: patch.rag, reason: patch.reason ?? '' }, ip);
    return getDashboard(session, key);
  });
