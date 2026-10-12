import { handle } from '@/lib/api';
import { listDashboardAudit } from '@/lib/data/insight';

/** RAG overrides, budget sharing and PDF exports for this project (Lead/Admin). */
export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => listDashboardAudit(session, (await params).key));
