import { handle } from '@/lib/api';
import { listNotifications, markNotificationsRead } from '@/lib/data/raid';
import { markReadSchema } from '@/lib/raid-schemas';

/** GET: the signed-in user's own notifications, newest first. */
export const GET = () => handle(({ session }) => listNotifications(session));

/** PATCH { ids?: string[] }: mark those (or all) of the user's notifications read. */
export const PATCH = (req: Request) =>
  handle(async ({ session }) => markNotificationsRead(session, markReadSchema.parse(await req.json()).ids));
