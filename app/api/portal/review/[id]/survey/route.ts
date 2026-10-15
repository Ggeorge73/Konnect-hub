import { handle } from '@/lib/api';
import { answerSurvey } from '@/lib/integration/service';
import { surveySchema } from '@/lib/domain/crm';

/** POST /api/portal/review/:id/survey — a 0–10 score and an optional comment. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) =>
    answerSurvey(session, decodeURIComponent((await params).id), surveySchema.parse(await req.json())),
  );
