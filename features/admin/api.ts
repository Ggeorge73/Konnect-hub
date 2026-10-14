'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import type {
  AdminInvite,
  AdminInviteInput,
  AdminOrg,
  AdminUser,
  CustomField,
  CustomFieldInput,
  CustomFieldPatch,
  FieldValues,
  TemplateCreateInput,
  TemplateSummary,
  UserPatch,
  WorkflowStatus,
} from '@/lib/domain/admin';
import type { ClientOrgInput } from '@/lib/domain/onboarding';
import type { Organization } from '@/lib/domain/types';

/** Client hooks for the Admin console (ADM-01) and the custom-field / workflow readers. */
export const adminKeys = {
  users: ['admin', 'users'] as const,
  invites: ['admin', 'invites'] as const,
  orgs: ['admin', 'orgs'] as const,
  templates: (archived: boolean) => ['templates', archived] as const,
  workflow: (projectKey: string) => ['workflow', projectKey] as const,
  fields: (archived: boolean) => ['custom-fields', archived] as const,
  itemFields: (itemKey: string) => ['item-fields', itemKey] as const,
  projectFields: (projectKey: string) => ['project-fields', projectKey] as const,
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Multipart POST (api() always sends JSON). */
export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body as T;
}

// Users ----------------------------------------------------------------------
export const useAdminUsers = () =>
  useQuery({ queryKey: adminKeys.users, queryFn: () => api<AdminUser[]>('/api/admin/users') });

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UserPatch }) =>
      api<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, json('PATCH', patch)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.users });
      qc.invalidateQueries({ queryKey: qk.people });
    },
  });
}

export const useResendUserInvite = () =>
  useMutation({
    mutationFn: (id: string) =>
      api<{ sentTo: string }>(`/api/admin/users/${encodeURIComponent(id)}/invite`, json('POST')),
  });

// Invites --------------------------------------------------------------------
export const useAdminInvites = () =>
  useQuery({ queryKey: adminKeys.invites, queryFn: () => api<AdminInvite[]>('/api/admin/invites') });

function useInviteMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: adminKeys.invites }),
  });
}
export const useInvite = () =>
  useInviteMutation((v: AdminInviteInput) => api<AdminInvite[]>('/api/admin/invites', json('POST', v)));
export const useResendInvite = () =>
  useInviteMutation((id: string) => api<AdminInvite>(`/api/admin/invites/${id}/resend`, json('POST')));
export const useRevokeInvite = () =>
  useInviteMutation((id: string) => api(`/api/admin/invites/${id}`, json('DELETE')));

// Client orgs ----------------------------------------------------------------
export const useAdminOrgs = () =>
  useQuery({ queryKey: adminKeys.orgs, queryFn: () => api<AdminOrg[]>('/api/admin/orgs') });

function useOrgMutation<V>(fn: (v: V) => Promise<Organization>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.orgs });
      qc.invalidateQueries({ queryKey: qk.orgs });
    },
  });
}
export const useCreateOrg = () =>
  useOrgMutation((v: ClientOrgInput) => api<Organization>('/api/admin/orgs', json('POST', v)));
export const useUpdateOrg = () =>
  useOrgMutation(({ id, ...v }: ClientOrgInput & { id: string }) =>
    api<Organization>(`/api/admin/orgs/${encodeURIComponent(id)}`, json('PATCH', v)),
  );
export const useUploadLogo = () =>
  useOrgMutation(({ id, file }: { id: string; file: File }) => {
    const form = new FormData();
    form.set('file', file);
    return postForm<Organization>(`/api/admin/orgs/${encodeURIComponent(id)}/logo`, form);
  });

// Templates ------------------------------------------------------------------
export const useTemplates = (opts: { archived?: boolean; enabled?: boolean } = {}) =>
  useQuery({
    queryKey: adminKeys.templates(Boolean(opts.archived)),
    queryFn: () => api<TemplateSummary[]>(`/api/templates${opts.archived ? '?archived=1' : ''}`),
    enabled: opts.enabled ?? true,
  });

function useTemplateMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }) });
}
export const useCreateTemplate = () =>
  useTemplateMutation((v: TemplateCreateInput) =>
    api<TemplateSummary>('/api/admin/templates', json('POST', v)),
  );
export const useArchiveTemplate = () =>
  useTemplateMutation((id: string) => api(`/api/admin/templates/${encodeURIComponent(id)}`, json('DELETE')));

// Workflow -------------------------------------------------------------------
export const useWorkflow = (projectKey: string | undefined) =>
  useQuery({
    queryKey: adminKeys.workflow(projectKey ?? ''),
    queryFn: () => api<WorkflowStatus[]>(`/api/projects/${projectKey}/workflow`),
    enabled: Boolean(projectKey),
    staleTime: 60_000,
  });

export function useSaveWorkflow(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (statuses: WorkflowStatus[]) =>
      api<WorkflowStatus[]>(`/api/projects/${projectKey}/workflow`, json('PUT', { statuses })),
    onSuccess: (data) => qc.setQueryData(adminKeys.workflow(projectKey), data),
  });
}

// Custom fields --------------------------------------------------------------
export const useCustomFields = (opts: { archived?: boolean } = {}) =>
  useQuery({
    queryKey: adminKeys.fields(Boolean(opts.archived)),
    queryFn: () => api<CustomField[]>(`/api/custom-fields${opts.archived ? '?archived=1' : ''}`),
    staleTime: 60_000,
  });

function useFieldMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields'] }),
  });
}
export const useCreateField = () =>
  useFieldMutation((v: CustomFieldInput) => api<CustomField>('/api/admin/custom-fields', json('POST', v)));
export const useUpdateField = () =>
  useFieldMutation(({ id, patch }: { id: string; patch: CustomFieldPatch }) =>
    api<CustomField>(`/api/admin/custom-fields/${encodeURIComponent(id)}`, json('PATCH', patch)),
  );

export const useItemFieldValues = (itemKey: string) =>
  useQuery({
    queryKey: adminKeys.itemFields(itemKey),
    queryFn: () => api<FieldValues>(`/api/items/${itemKey}/fields`),
  });

export function useSetFieldValue(itemKey: string, projectKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string | null }) =>
      api<FieldValues>(`/api/items/${itemKey}/fields/${encodeURIComponent(fieldId)}`, json('PUT', { value })),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.itemFields(itemKey), data);
      if (projectKey) qc.invalidateQueries({ queryKey: adminKeys.projectFields(projectKey) });
      qc.invalidateQueries({ queryKey: qk.item(itemKey) });
    },
  });
}

export const useProjectFieldValues = (projectKey: string, enabled = true) =>
  useQuery({
    queryKey: adminKeys.projectFields(projectKey),
    queryFn: () => api<Record<string, FieldValues>>(`/api/projects/${projectKey}/field-values`),
    enabled,
  });
