import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { clientOrgSchema } from '@/lib/domain/onboarding';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name, logoUrl }: renames a client org or changes its logo link (audited). */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    adminStore().updateClientOrg(
      session,
      (await params).id,
      clientOrgSchema.parse(await req.json()),
      requestIp(req),
    ),
  );
