import { z } from 'zod';
import { handle } from '@/lib/api';
import { getPreferences, setPreferences } from '@/lib/data/notify';
import { CHANNELS, NOTIFICATION_KINDS } from '@/lib/domain/notifications';

const schema = z.record(z.enum(NOTIFICATION_KINDS), z.enum(CHANNELS));

/** GET: the signed-in user's channel per event kind (defaults filled in). */
export const GET = () => handle(({ session }) => getPreferences(session));

/** PATCH { [kind]: 'in_app' | 'email' | 'digest' | 'off' }: change one or more kinds. */
export const PATCH = (req: Request) =>
  handle(async ({ session }) => setPreferences(session, schema.parse(await req.json())));
