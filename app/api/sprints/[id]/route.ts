import { handle } from '@/lib/api';
import { updateSprint } from '@/lib/data/sprints';
import { sprintPatchSchema } from '../schemas';

type Ctx = { params: Promise<{ id: string }> };
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    updateSprint(session, (await params).id, sprintPatchSchema.parse(await req.json())),
  );
