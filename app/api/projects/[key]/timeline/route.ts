import { handle } from '@/lib/api';
import { getTimeline, reschedule } from '@/lib/data/sprints';
import { rescheduleSchema } from '@/app/api/sprints/schemas';

type Ctx = { params: Promise<{ key: string }> };
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getTimeline(session, (await params).key));
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    reschedule(session, (await params).key, rescheduleSchema.parse(await req.json())),
  );
