import { handle } from '@/lib/api';
import { completeSprint } from '@/lib/data/sprints';
import { completeSprintSchema } from '../../schemas';

type Ctx = { params: Promise<{ id: string }> };
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    completeSprint(session, (await params).id, completeSprintSchema.parse(await req.json()).carryOver),
  );
