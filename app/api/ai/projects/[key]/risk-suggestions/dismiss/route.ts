import { handle } from '@/lib/api';
import { dismissRiskSuggestion } from '@/lib/ai/service';
import { dismissRiskSchema } from '@/lib/ai-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** POST {signalKeys}: dismiss a suggestion so the same signals are not suggested again. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    dismissRiskSuggestion(session, (await params).key, dismissRiskSchema.parse(await req.json()).signalKeys),
  );
