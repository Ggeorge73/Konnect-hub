import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { userPatchSchema } from '@/lib/domain/admin';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { role } changes a role (audited permission change); { active } (de)activates the user. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const { id } = await params;
    const v = userPatchSchema.parse(await req.json());
    const ip = requestIp(req);
    let user = v.role ? await adminStore().changeRole(session, id, v.role, ip) : undefined;
    if (v.active !== undefined) user = await adminStore().setActive(session, id, v.active, ip);
    return user;
  });
