import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** POST: re-sends the user a sign-in invite (magic link with Supabase, else email / dev outbox). */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => adminStore().resendUserInvite(session, (await params).id, requestIp(req)));
