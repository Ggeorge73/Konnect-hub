import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { requireAdmin } from '@/lib/data/admin-rules';
import { NotFoundError } from '@/lib/data/errors';
import { BRANDING_BUCKET, LOGO_TYPES, MAX_LOGO_BYTES } from '@/lib/domain/files';
import { readCheckedFile } from '@/lib/files/http';
import { fileStorage } from '@/lib/files/storage';
import { requestIp } from '@/lib/export-http';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST (multipart `file`): uploads a client logo through attachment storage (same limits check,
 * scan hook and private storage), then points the org at /api/orgs/:id/logo. Admin only, audited.
 */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    requireAdmin(session, 'edit clients');
    const { id } = await params;
    const org = (await adminStore().listClientOrgs(session)).find((o) => o.id === id);
    if (!org) throw new NotFoundError('Client not found');
    const f = await readCheckedFile(await req.formData(), { maxBytes: MAX_LOGO_BYTES, types: LOGO_TYPES });
    await fileStorage().put(BRANDING_BUCKET, `orgs/${org.id}/logo`, f.bytes, f.type);
    return adminStore().updateClientOrg(
      session,
      org.id,
      { name: org.name, logoUrl: `/api/orgs/${encodeURIComponent(org.id)}/logo?v=${Date.now()}` },
      requestIp(req),
    );
  });
