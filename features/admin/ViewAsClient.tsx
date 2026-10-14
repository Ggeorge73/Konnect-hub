'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { api } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import type { Organization } from '@/lib/domain/types';

const ROLES = ['client_sponsor', 'client_member', 'client_viewer'] as const;

/**
 * Admin card (CLAUDE.md §2, KH-47): preview the client portal as a client org and role. The preview
 * is read-only (every write is refused) and its start and stop are written to the audit log.
 */
export function ViewAsClientCard() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: orgs = [] } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<Organization[]>('/api/orgs'),
  });
  const clients = orgs.filter((o) => o.type === 'client');
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('client_sponsor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = orgId || clients[0]?.id || '';

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/session/preview', { method: 'POST', body: JSON.stringify({ orgId: chosen, role }) });
      qc.clear();
      router.push('/portal');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card
      component="section"
      aria-labelledby="admin-view-as-client"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <VisibilityOutlined color="primary" aria-hidden />
          <Typography variant="h3" component="h2" id="admin-view-as-client">
            View as client
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          See the portal exactly as a client role sees it. The preview is read-only and is recorded in the
          audit log.
        </Typography>
        <Stack spacing={2}>
          <TextField
            select
            label="Client organization"
            value={chosen}
            onChange={(e) => setOrgId(e.target.value)}
            size="small"
            disabled={!clients.length}
          >
            {clients.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Client role"
            value={role}
            onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
            size="small"
          >
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </MenuItem>
            ))}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </CardContent>
      <CardActions sx={{ px: 2, pb: 2 }}>
        <Button
          variant="contained"
          onClick={start}
          disabled={busy || !chosen}
          startIcon={<VisibilityOutlined aria-hidden />}
        >
          Start preview
        </Button>
      </CardActions>
    </Card>
  );
}
