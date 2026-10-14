import { handle } from '@/lib/api';
import { getBoardPage, type BoardFilters } from '@/lib/data/board';
import { parseLimits } from '@/lib/domain/board-page';

type Ctx = { params: Promise<{ key: string }> };

/**
 * KH-46: a page of the Kanban board. Query: type, assignee, label (comma lists), sprint, q,
 * limits=`status:n,...` (cards per column; default 100 each). Returns items, per-status totals,
 * the limits applied and the project's epics/features (for swimlanes).
 */
export const GET = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) => {
    const sp = new URL(req.url).searchParams;
    const list = (k: string) => sp.get(k)?.split(',').filter(Boolean) as never;
    const f: BoardFilters = {
      type: list('type'),
      assigneeId: list('assignee'),
      label: list('label'),
      sprintId: sp.has('sprint') ? sp.get('sprint') || null : undefined,
      q: sp.get('q')?.trim() || undefined,
    };
    return getBoardPage(session, (await params).key, f, parseLimits(sp.get('limits')));
  });
