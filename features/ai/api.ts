'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { RaidView } from '@/lib/domain/raid';
import type { WorkItem } from '@/lib/domain/types';
import type {
  AiStatus,
  MeetingNotesResult,
  ProposedItem,
  RiskSuggestion,
  RiskSuggestionsResult,
  StatusDraftResult,
  ThreadSummaryResult,
} from '@/lib/ai/views';
import { raidKeys } from '@/features/raid/api';

/** Client hooks for AI assist. Every call goes to /api/ai: the provider and key stay on the server. */

export const aiKeys = {
  status: (projectKey: string) => ['ai', 'status', projectKey] as const,
};

const post = <T>(url: string, body?: unknown) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const useAiStatus = (projectKey: string | undefined) =>
  useQuery({
    queryKey: aiKeys.status(projectKey ?? ''),
    queryFn: () => api<AiStatus>(`/api/ai/projects/${encodeURIComponent(projectKey!)}`),
    enabled: Boolean(projectKey),
  });

export function useToggleAi(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api<AiStatus>(`/api/ai/projects/${encodeURIComponent(projectKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (st) => qc.setQueryData(aiKeys.status(projectKey), st),
  });
}

export const useDraftReport = (reportId: string) =>
  useMutation({ mutationFn: () => post<StatusDraftResult>(`/api/ai/reports/${reportId}/draft`) });

export const useSuggestRisks = (projectKey: string) =>
  useMutation({
    mutationFn: (lookaheadDays: number) =>
      post<RiskSuggestionsResult>(`/api/ai/projects/${encodeURIComponent(projectKey)}/risk-suggestions`, {
        lookaheadDays,
      }),
  });

export function useDecideRisk(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      accept: boolean;
      suggestion: RiskSuggestion;
    }): Promise<RaidView | { dismissed: string[] }> =>
      v.accept
        ? post<RaidView>(`/api/ai/projects/${encodeURIComponent(projectKey)}/risk-suggestions/accept`, {
            title: v.suggestion.title,
            category: v.suggestion.category,
            probability: v.suggestion.probability,
            impact: v.suggestion.impact,
            mitigation: v.suggestion.mitigation,
            signalKeys: v.suggestion.signalKeys,
            linkedItemKeys: v.suggestion.linkedItemKeys,
          })
        : post<{ dismissed: string[] }>(
            `/api/ai/projects/${encodeURIComponent(projectKey)}/risk-suggestions/dismiss`,
            { signalKeys: v.suggestion.signalKeys },
          ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: raidKeys.project(projectKey) });
      qc.invalidateQueries({ queryKey: ['raid', 'item'] });
    },
  });
}

export const useMeetingNotes = (projectKey: string) =>
  useMutation({
    mutationFn: (notes: string) =>
      post<MeetingNotesResult>(`/api/ai/projects/${encodeURIComponent(projectKey)}/meeting-notes`, { notes }),
  });

export function useCreateFromNotes(projectKey: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: ProposedItem[]) =>
      post<WorkItem[]>(`/api/ai/projects/${encodeURIComponent(projectKey)}/meeting-notes/create`, { items }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.items(projectId) }),
  });
}

export const useThreadSummary = (itemKey: string) =>
  useMutation({
    mutationFn: () => post<ThreadSummaryResult>(`/api/ai/items/${encodeURIComponent(itemKey)}/summary`),
  });
