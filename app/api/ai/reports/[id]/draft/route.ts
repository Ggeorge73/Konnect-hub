import { handle } from '@/lib/api';
import { draftStatusReport } from '@/lib/ai/service';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** POST: an AI draft of each report section for the editor's preview. Nothing is saved. */
export const POST = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => draftStatusReport(session, (await params).id));
