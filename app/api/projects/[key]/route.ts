import { handle } from '@/lib/api';

export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session, repo }) => repo.getProjectBundle(session, (await params).key));
