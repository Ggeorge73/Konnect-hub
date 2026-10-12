import { handle } from '@/lib/api';
import { calendarPath } from '@/lib/data/calendar';

/** GET: the signed-in user's personal calendar feed path for this project. */
export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => calendarPath(session, (await params).key));
