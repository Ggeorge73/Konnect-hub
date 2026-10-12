import { handle } from '@/lib/api';
import { itemPatchSchema } from '@/lib/schemas';

type Ctx = { params: Promise<{ key: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) => repo.getItem(session, (await params).key));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session, repo }) =>
    repo.updateItem(session, (await params).key, itemPatchSchema.parse(await req.json())),
  );
