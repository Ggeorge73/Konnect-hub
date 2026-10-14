'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button } from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { api } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import type { Impersonation } from '@/lib/domain/types';

/** Shown on every portal page while an Admin previews it as a client (KH-47). */
export function PreviewBanner({ preview }: { preview: Impersonation }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const exit = async () => {
    setBusy(true);
    try {
      await api('/api/session/preview', { method: 'DELETE' });
    } finally {
      qc.clear();
      router.push('/admin');
      router.refresh();
    }
  };
  return (
    <Alert
      severity="warning"
      variant="filled"
      icon={<VisibilityOutlined aria-hidden />}
      role="status"
      data-testid="preview-banner"
      sx={{ borderRadius: 0, alignItems: 'center' }}
      action={
        <Button color="inherit" variant="outlined" size="small" onClick={exit} disabled={busy}>
          Exit preview
        </Button>
      }
    >
      Read-only preview: you are viewing the portal as {ROLE_LABEL[preview.role]} at {preview.orgName} (
      {preview.asUserName}). Changes are blocked.
    </Alert>
  );
}
