import { handle } from '@/lib/api';
import { invite, listInvites } from '@/lib/data/onboarding';
import { inviteSchema } from '@/lib/domain/onboarding';

export const GET = () => handle(({ session }) => listInvites(session));
export const POST = (req: Request) =>
  handle(async ({ session }) => invite(session, inviteSchema.parse(await req.json())));
