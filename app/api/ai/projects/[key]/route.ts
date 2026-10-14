import { handle } from '@/lib/api';
import { getAiStatus, setAiEnabled } from '@/lib/ai/service';
import { aiToggleSchema } from '@/lib/ai-schemas';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ key: string }> };

/** GET: AI assist status for the project (switch, provider, what the caller may use). */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getAiStatus(session, (await params).key));

/** PATCH {enabled}: the project's Lead or an Admin only (403 otherwise). Audited. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    setAiEnabled(session, (await params).key, aiToggleSchema.parse(await req.json()).enabled),
  );
