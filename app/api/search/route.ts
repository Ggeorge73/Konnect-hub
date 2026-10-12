import { handle } from '@/lib/api';

export const GET = (req: Request) =>
  handle(({ session, repo }) => {
    const sp = new URL(req.url).searchParams;
    const list = (k: string) => sp.get(k)?.split(',').filter(Boolean) as never;
    return repo.search(session, sp.get('q') ?? '', {
      type: list('type'),
      status: list('status'),
      visibility: (sp.get('visibility') as 'internal' | 'shared' | null) ?? undefined,
    });
  });
