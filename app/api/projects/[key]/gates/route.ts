import { handle } from '@/lib/api';
import { getGates } from '@/lib/data/gates';

export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session }) => getGates(session, (await params).key));
