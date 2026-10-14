import { getRepo } from '@/lib/data';
import { NotFoundError } from '@/lib/data/errors';
import { BRANDING_BUCKET } from '@/lib/domain/files';
import { fileRoute, serveStoredFile } from '@/lib/files/http';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** GET: an org's uploaded logo, for anyone who can see that org (clients: their own org only). */
export const GET = (_: Request, { params }: Ctx) =>
  fileRoute(async (session) => {
    const { id } = await params;
    const org = (await getRepo().listOrgs(session)).find((o) => o.id === id);
    if (!org) throw new NotFoundError('Not found');
    return serveStoredFile(
      { bucket: BRANDING_BUCKET, storagePath: `orgs/${org.id}/logo` },
      'logo',
      'image/png',
      true,
    );
  });
