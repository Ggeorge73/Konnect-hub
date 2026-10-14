import { handle } from '@/lib/api';
import { suggestRisks } from '@/lib/ai/service';
import { riskSuggestSchema } from '@/lib/ai-schemas';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ key: string }> };

/** POST {lookaheadDays?}: detect slipping signals and turn them into suggested risks (not saved). */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    suggestRisks(session, (await params).key, riskSuggestSchema.parse(await req.json().catch(() => ({})))),
  );
