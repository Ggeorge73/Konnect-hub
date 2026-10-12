import { handle } from '@/lib/api';
import { createItemSchema } from '@/lib/schemas';
import type { ItemFilters } from '@/lib/data/repo';

export const GET = (req: Request) =>
  handle(({ session, repo }) => {
    const sp = new URL(req.url).searchParams;
    const list = (k: string) => sp.get(k)?.split(',').filter(Boolean) as never;
    const f: ItemFilters = {
      projectId: sp.get('projectId') ?? undefined,
      type: list('type'),
      status: list('status'),
      assigneeId: list('assignee'),
      label: list('label'),
      phaseId: sp.get('phase') ?? undefined,
      sprintId: sp.has('sprint') ? sp.get('sprint') || null : undefined,
      visibility: (sp.get('visibility') as ItemFilters['visibility']) ?? undefined,
      q: sp.get('q') ?? undefined,
    };
    return repo.listItems(session, f);
  });

export const POST = (req: Request) =>
  handle(async ({ session, repo }) => repo.createItem(session, createItemSchema.parse(await req.json())));
