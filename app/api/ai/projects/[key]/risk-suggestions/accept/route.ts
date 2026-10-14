import { handle } from '@/lib/api';
import { acceptRiskSuggestion } from '@/lib/ai/service';
import { acceptRiskSchema } from '@/lib/ai-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** POST: the reviewer accepts a (possibly edited) suggestion: an internal risk linked to its items. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    acceptRiskSuggestion(session, (await params).key, acceptRiskSchema.parse(await req.json())),
  );
