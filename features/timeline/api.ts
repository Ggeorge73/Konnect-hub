'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { RescheduleInput, TimelineData } from '@/lib/data/sprints';
import { sprintKeys } from '@/features/backlog/api';

export const useTimeline = (projectKey: string) =>
  useQuery({
    queryKey: sprintKeys.timeline(projectKey),
    queryFn: () => api<TimelineData>(`/api/projects/${encodeURIComponent(projectKey)}/timeline`),
  });

/** Drag-to-reschedule with an optimistic update of the timeline cache. */
export function useReschedule(projectKey: string) {
  const qc = useQueryClient();
  const key = sprintKeys.timeline(projectKey);
  return useMutation({
    mutationFn: (input: RescheduleInput) =>
      api(`/api/projects/${encodeURIComponent(projectKey)}/timeline`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TimelineData>(key);
      qc.setQueryData<TimelineData>(key, (old) => {
        if (!old) return old;
        if (input.kind === 'sprint')
          return {
            ...old,
            sprints: old.sprints.map((s) =>
              s.id === input.id ? { ...s, startDate: input.startDate, endDate: input.endDate } : s,
            ),
          };
        const row = {
          itemId: input.id,
          projectId: old.project.id,
          startDate: input.startDate,
          endDate: input.endDate,
        };
        return {
          ...old,
          schedules: [...old.schedules.filter((x) => x.itemId !== input.id), row],
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: sprintKeys.list(projectKey) });
      qc.invalidateQueries({ queryKey: qk.project(projectKey) });
    },
  });
}
