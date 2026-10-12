import { handle } from '@/lib/api';
import { commentSchema } from '@/lib/schemas';

export const POST = (req: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session, repo }) =>
    repo.addComment(session, { itemId: (await params).key, ...commentSchema.parse(await req.json()) }),
  );
