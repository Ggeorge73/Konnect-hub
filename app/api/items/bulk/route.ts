import { handle } from '@/lib/api';
import { bulkSchema } from '@/lib/schemas';

export const POST = (req: Request) =>
  handle(async ({ session, repo }) => {
    const { ids, patch } = bulkSchema.parse(await req.json());
    return repo.bulkUpdate(session, ids, patch);
  });
