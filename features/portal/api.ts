'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { InboxEntry } from '@/lib/domain/portal';

export const portalKeys = { inbox: ['portal', 'inbox'] as const };

/** The "Needs your approval" inbox; the server render seeds it so there is no loading flash. */
export const useInbox = (initialData?: InboxEntry[]) =>
  useQuery({
    queryKey: portalKeys.inbox,
    queryFn: () => api<InboxEntry[]>('/api/portal/inbox'),
    initialData,
  });

export function useInvalidateInbox() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: portalKeys.inbox });
}
