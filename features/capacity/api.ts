'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { CapacityGrid, DirectoryEntry } from '@/lib/domain/capacity';
import type { AssignmentPreview, PersonDetail, ProjectTeam } from '@/lib/data/capacity';
import type { AllocationInput, AssignInput, PersonPatch } from '@/lib/capacity-schemas';

export const capacityKeys = {
  directory: ['capacity', 'directory'] as const,
  person: (id: string) => ['capacity', 'person', id] as const,
  grid: ['capacity', 'grid'] as const,
  team: (key: string) => ['capacity', 'team', key] as const,
};

export const useDirectory = () =>
  useQuery({
    queryKey: capacityKeys.directory,
    queryFn: () => api<DirectoryEntry[]>('/api/people/directory'),
  });

export const usePerson = (id: string | null) =>
  useQuery({
    queryKey: capacityKeys.person(id ?? ''),
    queryFn: () => api<PersonDetail>(`/api/people/${encodeURIComponent(id!)}`),
    enabled: Boolean(id),
  });

export const useGrid = (enabled = true) =>
  useQuery({ queryKey: capacityKeys.grid, queryFn: () => api<CapacityGrid>('/api/capacity/grid'), enabled });

export const useTeam = (projectKey: string) =>
  useQuery({
    queryKey: capacityKeys.team(projectKey),
    queryFn: () => api<ProjectTeam>(`/api/projects/${projectKey}/team`),
  });

const invalidateAll = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['capacity'] });

export function useUpdatePerson(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: PersonPatch) =>
      api<DirectoryEntry>(`/api/people/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: qk.people });
    },
  });
}

export function useSetAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AllocationInput) =>
      api<{ hours: number }>('/api/capacity/allocations', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => invalidateAll(qc),
  });
}

export const previewAssignment = (projectKey: string, input: Pick<AssignInput, 'userId' | 'allocationPct'>) =>
  api<AssignmentPreview>(`/api/projects/${projectKey}/team/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export function useAssign(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AssignInput) =>
      api<AssignmentPreview>(`/api/projects/${projectKey}/team`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: qk.project(projectKey) });
    },
  });
}

export function useRemoveMember(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api(`/api/projects/${projectKey}/team/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: qk.project(projectKey) });
    },
  });
}

export function useSetRestricted(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (restricted: boolean) =>
      api<{ restricted: boolean }>(`/api/projects/${projectKey}/restricted`, {
        method: 'PATCH',
        body: JSON.stringify({ restricted }),
      }),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: qk.project(projectKey) });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}
