import { handle } from '@/lib/api';
import { startSprint } from '@/lib/data/sprints';

type Ctx = { params: Promise<{ id: string }> };
export const POST = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => startSprint(session, (await params).id));
