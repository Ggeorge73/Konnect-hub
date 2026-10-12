'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type { GatesOverview } from '@/lib/data/gates';
import type { DeliverableView } from '@/lib/data/deliverables';
import type { DecisionInput, GateReview } from '@/lib/domain/gates';
import type { GateCriterion } from '@/lib/domain/types';

export const gk = {
  gates: (key: string) => ['gates', key] as const,
  deliverables: (key: string) => ['deliverables', key] as const,
};

export const useGates = (key: string) =>
  useQuery({ queryKey: gk.gates(key), queryFn: () => api<GatesOverview>(`/api/projects/${key}/gates`) });

export const useDeliverables = (key: string) =>
  useQuery({
    queryKey: gk.deliverables(key),
    queryFn: () => api<DeliverableView[]>(`/api/projects/${key}/deliverables`),
  });

/** Invalidate everything the gate tracker strip and tabs read, so they stay in sync. */
export function useGateInvalidate(key: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: gk.gates(key) }),
      qc.invalidateQueries({ queryKey: gk.deliverables(key) }),
      qc.invalidateQueries({ queryKey: qk.project(key) }),
      qc.invalidateQueries({ queryKey: qk.projects }),
      qc.invalidateQueries({ queryKey: qk.activity(key) }),
      qc.invalidateQueries({ queryKey: ['items'] }),
    ]);
}

export function useCriterionMutations(key: string) {
  const qc = useQueryClient();
  const done = useGateInvalidate(key);
  const base = `/api/projects/${key}/gates/criteria`;
  return {
    add: useMutation({
      mutationFn: (v: { phaseId: string; text: string }) =>
        api<GateCriterion>(base, { method: 'POST', body: JSON.stringify(v) }),
      onSettled: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: string; text?: string; done?: boolean }) =>
        api<GateCriterion>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      // Optimistic tick so the checkbox responds instantly; rolled back on error.
      onMutate: async ({ id, ...patch }) => {
        await qc.cancelQueries({ queryKey: gk.gates(key) });
        const prev = qc.getQueryData<GatesOverview>(gk.gates(key));
        if (prev)
          qc.setQueryData<GatesOverview>(gk.gates(key), {
            ...prev,
            criteria: prev.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          });
        return { prev };
      },
      onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(gk.gates(key), ctx.prev),
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
      onSettled: done,
    }),
  };
}

export function useRequestReview(key: string) {
  const done = useGateInvalidate(key);
  return useMutation({
    mutationFn: (v: { phaseId: string; overrideNote?: string; summary?: string; shareBudget?: boolean }) =>
      api<GateReview>(`/api/projects/${key}/gates/request`, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: done,
  });
}

export const decideGate = (reviewId: string, input: DecisionInput) =>
  api<GateReview>(`/api/gates/reviews/${reviewId}/decide`, { method: 'POST', body: JSON.stringify(input) });

export const decideCriterion = (
  deliverableId: string,
  criterionId: string,
  input: { status: 'accepted' | 'rejected'; note?: string },
) =>
  api<DeliverableView>(`/api/deliverables/${deliverableId}/criteria/${criterionId}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const reauthStatus = () => api<{ fresh: boolean; expiresAt: string | null }>('/api/reauth');
export const reauth = (email: string) =>
  api<{ ok: true; expiresAt: string }>('/api/reauth', { method: 'POST', body: JSON.stringify({ email }) });
