'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import type { PublishCheck, ReportGrid, ReportPatch, ReportView } from '@/lib/data/reports';

export const reportKeys = {
  grid: ['reports', 'grid'] as const,
  report: (id: string) => ['reports', 'one', id] as const,
  check: (id: string, shareBudget: boolean) => ['reports', 'check', id, shareBudget] as const,
};

export const useReportGrid = () =>
  useQuery({ queryKey: reportKeys.grid, queryFn: () => api<ReportGrid>('/api/reports/grid') });

export const useReport = (id: string) =>
  useQuery({ queryKey: reportKeys.report(id), queryFn: () => api<ReportView>(`/api/reports/${id}`) });

export function useGenerateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { projectKey: string; weekStart?: string }) =>
      api<ReportView>('/api/reports', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: (r) => {
      qc.setQueryData(reportKeys.report(r.id), r);
      qc.invalidateQueries({ queryKey: reportKeys.grid });
    },
  });
}

export function useUpdateReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: ReportPatch) =>
      api<ReportView>(`/api/reports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (r) => {
      qc.setQueryData(reportKeys.report(id), r);
      qc.invalidateQueries({ queryKey: ['reports', 'check', id] });
    },
  });
}

export const usePublishCheck = (id: string, shareBudget: boolean, enabled: boolean) =>
  useQuery({
    queryKey: reportKeys.check(id, shareBudget),
    queryFn: () => api<PublishCheck>(`/api/reports/${id}/publish${shareBudget ? '?shareBudget=1' : ''}`),
    enabled,
  });

export function usePublishReport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { shareBudget: boolean }) =>
      api<ReportView>(`/api/reports/${id}/publish`, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: (r) => {
      qc.setQueryData(reportKeys.report(id), r);
      qc.invalidateQueries({ queryKey: reportKeys.grid });
    },
  });
}
