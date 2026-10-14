'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { ApprovalGroup, TimeEntryView } from '@/lib/domain/ledger';
import type { ItemTimeSummary, LogTimeInput, TimePatch } from '@/lib/data/ledger';

export const timeKeys = {
  all: ['time'] as const,
  week: (week: string) => ['time', 'week', week] as const,
  item: (key: string) => ['time', 'item', key] as const,
  approvals: ['time', 'approvals'] as const,
};

export const useWeek = (week: string) =>
  useQuery({
    queryKey: timeKeys.week(week),
    queryFn: () => api<TimeEntryView[]>(`/api/time?week=${week}`),
  });

export const useItemTime = (itemKey: string, enabled = true) =>
  useQuery({
    queryKey: timeKeys.item(itemKey),
    queryFn: () => api<ItemTimeSummary>(`/api/items/${encodeURIComponent(itemKey)}/time`),
    enabled,
  });

export const useApprovals = () =>
  useQuery({ queryKey: timeKeys.approvals, queryFn: () => api<ApprovalGroup[]>('/api/time/approvals') });

/** Every time mutation refreshes all time queries (week grid, item panel, approvals). */
function useTimeMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: timeKeys.all }),
  });
}

export const useLogTime = () =>
  useTimeMutation((v: LogTimeInput) =>
    api<TimeEntryView>('/api/time', { method: 'POST', body: JSON.stringify(v) }),
  );

export const useUpdateTime = () =>
  useTimeMutation((v: { id: string; patch: TimePatch }) =>
    api<TimeEntryView>(`/api/time/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.patch) }),
  );

export const useDeleteTime = () =>
  useTimeMutation((id: string) => api<{ ok: boolean }>(`/api/time/${id}`, { method: 'DELETE' }));

export const useSubmitWeek = () =>
  useTimeMutation((week: string) =>
    api<TimeEntryView[]>('/api/time/submit', { method: 'POST', body: JSON.stringify({ week }) }),
  );

export const useDecideTime = () =>
  useTimeMutation((v: { ids: string[]; decision: 'approved' | 'rejected'; reason?: string }) =>
    api<TimeEntryView[]>('/api/time/approvals', { method: 'POST', body: JSON.stringify(v) }),
  );

/** Today's date (YYYY-MM-DD) in the viewer's time zone. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2.5 h" */
export const formatHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} h`;
