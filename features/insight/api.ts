'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { DashboardView, PortfolioView } from '@/lib/data/insight';
import type { DashboardPatch } from '@/lib/insight-schemas';

export const insightKeys = {
  dashboard: (key: string) => ['dashboard', key] as const,
  portfolio: ['portfolio'] as const,
};

export const useDashboard = (projectKey: string, initialData?: DashboardView) =>
  useQuery({
    queryKey: insightKeys.dashboard(projectKey),
    queryFn: () => api<DashboardView>(`/api/projects/${projectKey}/dashboard`),
    initialData,
  });

export const usePortfolio = () =>
  useQuery({
    queryKey: insightKeys.portfolio,
    queryFn: () => api<PortfolioView>('/api/dashboards/portfolio'),
  });

export function usePatchDashboard(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: DashboardPatch) =>
      api<DashboardView>(`/api/projects/${projectKey}/dashboard`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (view) => {
      qc.setQueryData(insightKeys.dashboard(projectKey), view);
      qc.invalidateQueries({ queryKey: qk.project(projectKey) });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: insightKeys.portfolio });
    },
  });
}
