import { handle } from '@/lib/api';
import { getProjectMetrics } from '@/lib/data/metrics';

type Ctx = { params: Promise<{ key: string }> };

/** GET: velocity, burndown, cumulative flow, cycle time and throughput (internal users). */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => getProjectMetrics(session, (await params).key));
