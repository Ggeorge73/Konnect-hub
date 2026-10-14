'use client';
import { useQuery } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import { formatLimits, type BoardLimits, type BoardPage } from '@/lib/domain/board-page';
import type { ItemType } from '@/lib/domain/types';

export interface BoardQuery {
  types: ItemType[];
  assignee?: string;
  sprintId?: string;
  q?: string;
}

/**
 * KH-46: the board's server-paged data. The key sits under qk.items(projectId), so every
 * existing invalidation (item updates, quick add, realtime) refreshes it, and useUpdateItem's
 * optimistic patch reaches it too. The previous page stays on screen while a new one loads.
 */
export function useBoard(projectKey: string, projectId: string, q: BoardQuery, limits: BoardLimits) {
  const params = new URLSearchParams();
  if (q.types.length) params.set('type', q.types.join(','));
  if (q.assignee) params.set('assignee', q.assignee);
  if (q.sprintId) params.set('sprint', q.sprintId);
  if (q.q?.trim()) params.set('q', q.q.trim());
  const l = formatLimits(limits);
  if (l) params.set('limits', l);
  const qs = params.toString();
  return useQuery({
    queryKey: [...qk.items(projectId), 'board', qs] as const,
    queryFn: () => api<BoardPage>(`/api/projects/${encodeURIComponent(projectKey)}/board?${qs}`),
    // Keep the previous page on screen while filters or limits change (same project only).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === projectId ? prev : undefined),
  });
}
