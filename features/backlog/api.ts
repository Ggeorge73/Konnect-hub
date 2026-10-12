'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { Sprint } from '@/lib/domain/types';
import type { CarryOver, SprintInput } from '@/lib/domain/sprints';
import type { CompletionResult, SprintList } from '@/lib/data/sprints';

export const sprintKeys = {
  list: (projectKey: string) => ['sprints', projectKey] as const,
  timeline: (projectKey: string) => ['timeline', projectKey] as const,
};

export const useSprints = (projectKey: string) =>
  useQuery({
    queryKey: sprintKeys.list(projectKey),
    queryFn: () => api<SprintList>(`/api/sprints?project=${encodeURIComponent(projectKey)}`),
  });

/** Sprint changes touch the bundle (board's active sprint), the items and the timeline. */
function useInvalidateSprints(projectKey: string, projectId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: sprintKeys.list(projectKey) });
    qc.invalidateQueries({ queryKey: sprintKeys.timeline(projectKey) });
    qc.invalidateQueries({ queryKey: qk.project(projectKey) });
    qc.invalidateQueries({ queryKey: qk.items(projectId) });
    qc.invalidateQueries({ queryKey: qk.activity(projectKey) });
    qc.invalidateQueries({ queryKey: qk.projects });
  };
}

export function useCreateSprint(projectKey: string, projectId: string) {
  const invalidate = useInvalidateSprints(projectKey, projectId);
  return useMutation({
    mutationFn: (input: SprintInput) =>
      api<Sprint>('/api/sprints', { method: 'POST', body: JSON.stringify({ ...input, projectId }) }),
    onSuccess: invalidate,
  });
}

export function useStartSprint(projectKey: string, projectId: string) {
  const invalidate = useInvalidateSprints(projectKey, projectId);
  return useMutation({
    mutationFn: (id: string) => api<Sprint>(`/api/sprints/${id}/start`, { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useCompleteSprint(projectKey: string, projectId: string) {
  const invalidate = useInvalidateSprints(projectKey, projectId);
  return useMutation({
    mutationFn: ({ id, carryOver }: { id: string; carryOver: CarryOver }) =>
      api<CompletionResult>(`/api/sprints/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ carryOver }),
      }),
    onSettled: invalidate,
  });
}

export function useSetHoursPerPoint(projectKey: string, projectId: string) {
  const invalidate = useInvalidateSprints(projectKey, projectId);
  return useMutation({
    mutationFn: (hoursPerPoint: number) =>
      api('/api/sprints/settings', {
        method: 'PUT',
        body: JSON.stringify({ project: projectKey, hoursPerPoint }),
      }),
    onSettled: invalidate,
  });
}
