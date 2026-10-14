'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client/api';
import { postForm } from '@/features/admin/api';
import type { Attachment, AttachmentParent, AttachmentTarget } from '@/lib/domain/files';
import type { Visibility } from '@/lib/domain/types';

export const fileKeys = {
  list: (type: AttachmentParent, id: string) => ['attachments', type, id] as const,
};

export const downloadUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}/download`;

/** Files on an item (including its comments' files) or a RAID entry. */
export const useAttachments = (type: AttachmentParent, id: string, enabled = true) =>
  useQuery({
    queryKey: fileKeys.list(type, id),
    queryFn: () =>
      api<Attachment[]>(`/api/attachments?entityType=${type}&entityId=${encodeURIComponent(id)}`),
    enabled: enabled && Boolean(id),
  });

export function useUpload(parent: { type: AttachmentParent; id: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { file: File; target: AttachmentTarget; targetId: string; visibility: Visibility }) => {
      const form = new FormData();
      form.set('file', v.file);
      form.set('entityType', v.target);
      form.set('entityId', v.targetId);
      form.set('visibility', v.visibility);
      return postForm<Attachment>('/api/attachments', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.list(parent.type, parent.id) }),
  });
}

export function useDeleteAttachment(parent: { type: AttachmentParent; id: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.list(parent.type, parent.id) }),
  });
}
