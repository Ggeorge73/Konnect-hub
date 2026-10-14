import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => adminStore().resendInvite(session, (await params).id, requestIp(req)));
