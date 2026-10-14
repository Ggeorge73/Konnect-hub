'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ItemDetail,
  ItemPatch,
  ProjectBundle,
  ProjectSummary,
  SearchResult,
  CreateItemInput,
  CreateProjectInput,
} from '@/lib/data/repo';
import type {
  ActivityEvent,
  Comment,
  Impersonation,
  Organization,
  Profile,
  Project,
  Visibility,
  WorkItem,
} from '@/lib/domain/types';

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  items: (projectId: string) => ['items', projectId] as const,
  item: (key: string) => ['item', key] as const,
  activity: (key: string) => ['activity', key] as const,
  people: ['people'] as const,
  orgs: ['orgs'] as const,
  search: (q: string, f: string) => ['search', q, f] as const,
};

/** GET /api/session: `auth` is 'supabase' (real sign-in) or 'demo' (persona switcher). */
export interface Me {
  user: Profile;
  org: Organization;
  auth: 'supabase' | 'demo';
  /** KH-47: set while an Admin previews the portal as a client (read-only). */
  impersonation?: Impersonation | null;
}
export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api<Me>('/api/session') });
export const useProjects = () =>
  useQuery({ queryKey: qk.projects, queryFn: () => api<ProjectSummary[]>('/api/projects') });
export const useProject = (key: string) =>
  useQuery({ queryKey: qk.project(key), queryFn: () => api<ProjectBundle>(`/api/projects/${key}`) });
export const useItems = (projectId: string | undefined) =>
  useQuery({
    queryKey: qk.items(projectId ?? ''),
    queryFn: () => api<WorkItem[]>(`/api/items?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
export const useItem = (key: string | null) =>
  useQuery({
    queryKey: qk.item(key ?? ''),
    queryFn: () => api<ItemDetail>(`/api/items/${key}`),
    enabled: Boolean(key),
  });
export const useActivity = (key: string) =>
  useQuery({
    queryKey: qk.activity(key),
    queryFn: () => api<ActivityEvent[]>(`/api/projects/${key}/activity`),
  });
export const usePeople = () =>
  useQuery({ queryKey: qk.people, queryFn: () => api<Profile[]>('/api/people') });
export const useOrgs = () => useQuery({ queryKey: qk.orgs, queryFn: () => api<Organization[]>('/api/orgs') });
export const useSearch = (q: string, filters: string) =>
  useQuery({
    queryKey: qk.search(q, filters),
    queryFn: () => api<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}${filters}`),
    enabled: q.trim().length > 1,
  });

export const prefetchItem = (qc: ReturnType<typeof useQueryClient>, key: string) =>
  qc.prefetchQuery({
    queryKey: qk.item(key),
    queryFn: () => api<ItemDetail>(`/api/items/${key}`),
    staleTime: 10_000,
  });

/** Optimistic item update shared by the board, list and side panel. */
export function useUpdateItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ItemPatch }) =>
      api<WorkItem>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.items(projectId) });
      const prev = qc.getQueryData<WorkItem[]>(qk.items(projectId));
      const { offlineAcceptanceNote: _n, ...fields } = patch;
      qc.setQueryData<WorkItem[]>(qk.items(projectId), (old) =>
        old?.map((i) => (i.id === id || i.key === id ? { ...i, ...fields } : i)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.items(projectId), ctx.prev),
    onSettled: (data) => {
      qc.invalidateQueries({ queryKey: qk.items(projectId) });
      qc.invalidateQueries({ queryKey: qk.projects });
      if (data) qc.invalidateQueries({ queryKey: qk.item(data.key) });
    },
  });
}

export function useBulkUpdate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids: string[]; patch: ItemPatch }) =>
      api<WorkItem[]>('/api/items/bulk', { method: 'POST', body: JSON.stringify(v) }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.items(projectId) }),
  });
}

export function useCreateItem(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateItemInput) =>
      api<WorkItem>('/api/items', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.items(projectId) });
      qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useAddComment(itemKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { body: string; visibility: Visibility }) =>
      api<Comment>(`/api/items/${itemKey}/comments`, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.item(itemKey) }),
  });
}
