import { handle } from '@/lib/api';
import { extractMeetingNotes } from '@/lib/ai/service';
import { meetingNotesSchema } from '@/lib/ai-schemas';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ key: string }> };

/** POST {notes}: proposed work items for the preview table. Nothing is created here. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) =>
    extractMeetingNotes(session, repo, (await params).key, meetingNotesSchema.parse(await req.json()).notes),
  );
