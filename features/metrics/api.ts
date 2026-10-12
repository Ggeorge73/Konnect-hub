'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { ProjectMetrics } from '@/lib/domain/metrics';

export const metricsKeys = { project: (key: string) => ['metrics', key] as const };

export const useProjectMetrics = (projectKey: string) =>
  useQuery({
    queryKey: metricsKeys.project(projectKey),
    queryFn: () => api<ProjectMetrics>(`/api/projects/${encodeURIComponent(projectKey)}/metrics`),
  });
