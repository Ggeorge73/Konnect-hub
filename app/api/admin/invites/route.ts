import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { adminInviteSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

/** ADM-01 invites: list, and invite people by email with a role and an org (Admin only). */
export const GET = () => handle(({ session }) => adminStore().listInvites(session));
export const POST = (req: Request) =>
  handle(async ({ session }) =>
    adminStore().invite(session, adminInviteSchema.parse(await req.json()), requestIp(req)),
  );
