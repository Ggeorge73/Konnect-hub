import { handle } from '@/lib/api';
import { listItems } from '@/lib/integration/service';
import { isOpenItem } from '@/lib/domain/crm';
import { isClientRole } from '@/lib/domain/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/review[?project=KEY] — "For your review": commercial items published by the CRM
 * for the signed-in client's organization (optionally one project), with the open count.
 */
export const GET = (req: Request) =>
  handle(async ({ session }) => {
    const project = new URL(req.url).searchParams.get('project') ?? undefined;
    if (!isClientRole(session.user.role) && !project) return { items: [], open: 0 };
    const items = await listItems(session, project);
    return { items, open: isClientRole(session.user.role) ? items.filter(isOpenItem).length : 0 };
  });
