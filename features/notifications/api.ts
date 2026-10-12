'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import { raidKeys } from '@/features/raid/api';
import type { Channel, Notification, NotificationKind } from '@/lib/domain/notifications';

export const signalKeys = {
  notifications: raidKeys.notifications,
  prefs: ['notification-prefs'] as const,
  watch: (key: string) => ['watch', key] as const,
  presence: (key: string) => ['presence', key] as const,
  calendar: (key: string) => ['calendar', key] as const,
};

export type Prefs = Partial<Record<NotificationKind, Channel>>;

export const useNotifications = () =>
  useQuery({
    queryKey: signalKeys.notifications,
    queryFn: () => api<Notification[]>('/api/notifications'),
    refetchInterval: 30_000,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api<Notification[]>('/api/notifications', { method: 'PATCH', body: JSON.stringify({ ids }) }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: signalKeys.notifications });
      const at = new Date().toISOString();
      qc.setQueryData<Notification[]>(signalKeys.notifications, (old) =>
        old?.map((n) => (!n.readAt && (!ids || ids.includes(n.id)) ? { ...n, readAt: at } : n)),
      );
    },
    onSuccess: (data) => qc.setQueryData(signalKeys.notifications, data),
  });
}

export const usePreferences = () =>
  useQuery({ queryKey: signalKeys.prefs, queryFn: () => api<Prefs>('/api/notifications/preferences') });

export function useSetPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Prefs) =>
      api<Prefs>('/api/notifications/preferences', { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: (patch) => qc.setQueryData<Prefs>(signalKeys.prefs, (old) => ({ ...old, ...patch })),
    onSuccess: (data) => qc.setQueryData(signalKeys.prefs, data),
    onError: () => qc.invalidateQueries({ queryKey: signalKeys.prefs }),
  });
}

export const useWatch = (itemKey: string) =>
  useQuery({
    queryKey: signalKeys.watch(itemKey),
    queryFn: () => api<{ watching: boolean; count: number }>(`/api/items/${itemKey}/watch`),
  });

export function useSetWatch(itemKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (watching: boolean) =>
      api<{ watching: boolean; count: number }>(`/api/items/${itemKey}/watch`, {
        method: 'PUT',
        body: JSON.stringify({ watching }),
      }),
    onSuccess: (data) => qc.setQueryData(signalKeys.watch(itemKey), data),
  });
}

export const useCalendarPath = (projectKey: string, enabled: boolean) =>
  useQuery({
    queryKey: signalKeys.calendar(projectKey),
    queryFn: () => api<{ path: string }>(`/api/projects/${projectKey}/calendar`),
    enabled,
    staleTime: Infinity,
  });
