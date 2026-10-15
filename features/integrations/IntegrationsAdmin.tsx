'use client';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import CallReceivedOutlined from '@mui/icons-material/CallReceivedOutlined';
import CallMadeOutlined from '@mui/icons-material/CallMadeOutlined';
import { api } from '@/lib/client/api';
import { EmptyState, Mono } from '@/components/ui/bits';
import { AdminPage } from '@/features/admin/AdminPage';
import type { IntegrationEvent, IntegrationStatus } from '@/lib/domain/crm';

interface IntegrationsView {
  mode: 'mock' | 'live' | 'off';
  crmHost: string | null;
  events: IntegrationEvent[];
}

const KEY = ['admin', 'integrations'] as const;

const STATUS_COLOR: Record<IntegrationStatus, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  processed: 'success',
  pending: 'info',
  failed: 'warning',
  dead: 'error',
  rejected: 'error',
};

const STATUS_TEXT: Record<IntegrationStatus, string> = {
  processed: 'Processed',
  pending: 'Pending',
  failed: 'Failed · will retry',
  dead: 'Failed · gave up',
  rejected: 'Rejected',
};

type Filter = 'all' | 'problems';

/**
 * Admin console → Integrations: every Konnector CRM event in and out (handoffs, commercial items,
 * decisions, project health) with status, attempts and the last error, and a Retry button.
 */
export function IntegrationsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<IntegrationsView>('/api/admin/integrations') });
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });

  const retry = useMutation({
    mutationFn: (id: string) =>
      api<IntegrationEvent>(`/api/admin/integrations/${id}/retry`, { method: 'POST' }),
    onSuccess: (e) => {
      setNote({
        severity: e.status === 'processed' ? 'success' : 'error',
        text:
          e.status === 'processed'
            ? `${e.event} delivered.`
            : `${e.event}: ${e.lastError ?? 'still failing'}`,
      });
      refresh();
    },
    onError: (e) => setNote({ severity: 'error', text: (e as Error).message }),
  });
  const health = useMutation({
    mutationFn: () => api<{ sent: number }>('/api/admin/integrations/health', { method: 'POST' }),
    onSuccess: (r) => {
      setNote({
        severity: 'success',
        text: `Project health sent for ${r.sent} project${r.sent === 1 ? '' : 's'}.`,
      });
      refresh();
    },
    onError: (e) => setNote({ severity: 'error', text: (e as Error).message }),
  });

  const events = (q.data?.events ?? []).filter(
    (e) => filter === 'all' || ['failed', 'dead', 'rejected'].includes(e.status),
  );
  const problems = (q.data?.events ?? []).filter((e) =>
    ['failed', 'dead', 'rejected'].includes(e.status),
  ).length;

  return (
    <AdminPage
      title="Integrations"
      intro="Konnector CRM: deals handed off as projects, commercial items for the portal, client decisions and project health."
      action={
        <Button
          variant="outlined"
          startIcon={<MonitorHeartOutlined />}
          onClick={() => health.mutate()}
          disabled={health.isPending}
        >
          Send project health now
        </Button>
      }
    >
      {q.data && (
        <Alert severity={q.data.mode === 'off' ? 'warning' : 'info'} data-testid="crm-mode">
          {q.data.mode === 'live' && (
            <>
              Delivering to <Mono>{q.data.crmHost}</Mono>.
            </>
          )}
          {q.data.mode === 'mock' &&
            'Mock CRM: events are delivered to the in-process mock (development only).'}
          {q.data.mode === 'off' && 'CRM_BASE_URL is not set: outbound events wait and retry until it is.'}
        </Alert>
      )}
      {note && (
        <Alert severity={note.severity} onClose={() => setNote(null)} role="status">
          {note.text}
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_, v: Filter | null) => v && setFilter(v)}
          aria-label="Filter events"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="problems">Failures ({problems})</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
        {q.isLoading ? (
          <Stack spacing={1} sx={{ p: 2 }}>
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} height={40} />
            ))}
          </Stack>
        ) : q.isError ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {(q.error as Error).message}
          </Alert>
        ) : events.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? 'No CRM events yet' : 'No failures'}
            body={
              filter === 'all'
                ? 'When the CRM hands off a won deal or publishes a quote, it shows up here.'
                : 'Every event was delivered or processed.'
            }
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Integration events">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Event</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Attempts</TableCell>
                  <TableCell>When</TableCell>
                  <TableCell>Last error</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {events.map((e) => (
                  <Fragment key={e.id}>
                    <TableRow hover data-testid={`event-${e.event}`}>
                      <TableCell padding="checkbox">
                        <IconButton
                          size="small"
                          aria-label={open === e.id ? 'Hide payload' : 'Show payload'}
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          {open === e.id ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          {e.direction === 'inbound' ? (
                            <CallReceivedOutlined fontSize="small" titleAccess="From the CRM" />
                          ) : (
                            <CallMadeOutlined fontSize="small" titleAccess="To the CRM" />
                          )}
                          <Mono>{e.event}</Mono>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" color={STATUS_COLOR[e.status]} label={STATUS_TEXT[e.status]} />
                      </TableCell>
                      <TableCell align="right">
                        <Mono>{e.attempts}</Mono>
                      </TableCell>
                      <TableCell>
                        <Mono>{e.createdAt.slice(0, 16).replace('T', ' ')}</Mono>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320, overflowWrap: 'anywhere' }}>
                        <Typography variant="body2" color="text.secondary">
                          {e.lastError ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {(e.status === 'failed' || e.status === 'dead' || e.status === 'pending') && (
                          <Button
                            size="small"
                            startIcon={<ReplayOutlined />}
                            onClick={() => retry.mutate(e.id)}
                            disabled={retry.isPending}
                            aria-label={`Retry ${e.event}`}
                          >
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0, borderBottom: open === e.id ? undefined : 'none' }}>
                        <Collapse in={open === e.id} unmountOnExit>
                          <Box
                            component="pre"
                            sx={{
                              m: 0,
                              py: 1.5,
                              fontSize: 12,
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {JSON.stringify({ payload: e.payload, response: e.response }, null, 2)}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </AdminPage>
  );
}
