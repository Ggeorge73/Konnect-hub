'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { RaidView } from '@/lib/domain/raid';
import type { Notification } from '@/lib/domain/notifications';
import type { CreateRaidInput, RaidPatch } from '@/lib/raid-schemas';

export const raidKeys = {
  project: (key: string) => ['raid', 'project', key] as const,
  item: (key: string) => ['raid', 'item', key] as const,
  notifications: ['notifications'] as const,
};

export const useRaid = (projectKey: string) =>
  useQuery({
    queryKey: raidKeys.project(projectKey),
    queryFn: () => api<RaidView[]>(`/api/raid?project=${encodeURIComponent(projectKey)}`),
  });

export const useItemRaid = (itemKey: string) =>
  useQuery({
    queryKey: raidKeys.item(itemKey),
    queryFn: () => api<RaidView[]>(`/api/raid?item=${encodeURIComponent(itemKey)}`),
  });

export function useSaveRaid(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string; create?: CreateRaidInput; patch?: RaidPatch }) =>
      v.id
        ? api<RaidView>(`/api/raid/${v.id}`, { method: 'PATCH', body: JSON.stringify(v.patch) })
        : api<RaidView>('/api/raid', { method: 'POST', body: JSON.stringify(v.create) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: raidKeys.project(projectKey) });
      qc.invalidateQueries({ queryKey: ['raid', 'item'] });
      qc.invalidateQueries({ queryKey: raidKeys.notifications });
    },
  });
}

export const useNotifications = () =>
  useQuery({
    queryKey: raidKeys.notifications,
    queryFn: () => api<Notification[]>('/api/notifications'),
    refetchInterval: 60_000,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api<Notification[]>('/api/notifications', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    onSuccess: (data) => qc.setQueryData(raidKeys.notifications, data),
  });
}
