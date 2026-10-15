import { handle } from '@/lib/api';
import { openItem } from '@/lib/integration/service';
import { actionBlocker } from '@/lib/domain/crm';
import { isClientRole } from '@/lib/domain/permissions';

export const dynamic = 'force-dynamic';

/** GET /api/portal/review/:id — one item. The first open by a client user tells the CRM. */
export const GET = (_req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) => {
    const item = await openItem(session, decodeURIComponent((await params).id));
    return {
      item,
      blocker: isClientRole(session.user.role)
        ? actionBlocker(session.user.role, item)
        : 'Owned by the CRM: Konnector users can only view it.',
    };
  });
