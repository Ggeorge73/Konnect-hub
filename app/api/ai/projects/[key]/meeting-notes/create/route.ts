import { handle } from '@/lib/api';
import { createItemsFromNotes } from '@/lib/ai/service';
import { createFromNotesSchema } from '@/lib/ai-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** POST {items}: create the rows the user ticked, as internal backlog items. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) =>
    createItemsFromNotes(
      session,
      repo,
      (await params).key,
      createFromNotesSchema.parse(await req.json()).items,
    ),
  );
