import { handle } from '@/lib/api';
import { retryEvent } from '@/lib/integration/service';

/** POST /api/admin/integrations/:id/retry — Admin only: deliver (or re-apply) one event now. */
export const POST = (_req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async ({ session }) => retryEvent(session, (await params).id));
