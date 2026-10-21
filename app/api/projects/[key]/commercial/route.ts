import { handle } from '@/lib/api';
import { getProjectCommercial } from '@/lib/integration/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/:key/commercial — Konnector users (not associates), read-only: the CRM handoff
 * details (Admins and Leads) and the commercial items published to the client.
 */
export const GET = (_req: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => getProjectCommercial(session, (await params).key));
