import { handle } from '@/lib/api';

export const GET = (_: Request, { params }: { params: Promise<{ key: string }> }) =>
  handle(async ({ session, repo }) => repo.listActivity(session, (await params).key, 30));
