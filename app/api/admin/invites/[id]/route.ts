import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** DELETE revokes a pending invite (audited). */
export const DELETE = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => adminStore().revokeInvite(session, (await params).id, requestIp(req)));
