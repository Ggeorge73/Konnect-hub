import { handle } from '@/lib/api';
import { summarizeThread } from '@/lib/ai/service';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ key: string }> };

/** POST: summary of the comments the caller can see (clients: shared only). Shown, not stored. */
export const POST = (_: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) => summarizeThread(session, repo, (await params).key));
