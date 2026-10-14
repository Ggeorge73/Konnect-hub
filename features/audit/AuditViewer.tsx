'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import { api } from '@/lib/client/api';
import type { AuditPage, AuditRow } from '@/lib/data/audit';
import { jsonDiff, showValue, type DiffKind } from '@/lib/domain/audit-diff';
import { EmptyState, Mono } from '@/components/ui/bits';
import { ExportMenu } from '@/features/exports/ExportMenu';

interface Filters {
  actor: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { actor: '', action: '', from: '', to: '' };

const params = (f: Filters) => ({
  actor: f.actor || undefined,
  action: f.action.trim() || undefined,
  from: f.from || undefined,
  to: f.to || undefined,
});

/**
 * Audit log viewer (AUD-01, Admin only): who did what, to which entity, when and from where.
 * Read-only by design: the log is append-only and this page has no edit or delete paths.
 */
export function AuditViewer() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const qs = new URLSearchParams(
    Object.entries({ ...params(f), page: String(page + 1), pageSize: String(pageSize) }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit', qs.toString()],
    queryFn: () => api<AuditPage>(`/api/admin/audit?${qs}`),
    placeholderData: keepPreviousData,
  });
  const set = (k: keyof Filters, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h1">Audit log</Typography>
          <Typography color="text.secondary">
            Logins, permission changes, gate and acceptance decisions, visibility changes, exports and
            deletions. Append-only: entries can’t be edited or removed.
          </Typography>
        </Box>
        <ExportMenu entity="audit" params={params(f)} label="Export filtered" />
      </Stack>
      <Paper sx={{ borderRadius: 4 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ p: 2 }}
          component="section"
          aria-label="Filters"
        >
          <TextField
            select
            size="small"
            label="Actor"
            value={f.actor}
            onChange={(e) => set('actor', e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">Anyone</MenuItem>
            {(data?.actors ?? []).map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Action starts with"
            placeholder="export."
            value={f.action}
            onChange={(e) => set('action', e.target.value)}
          />
          <TextField
            size="small"
            type="date"
            label="From"
            value={f.from}
            onChange={(e) => set('from', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            value={f.to}
            onChange={(e) => set('to', e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button onClick={() => (setF(EMPTY), setPage(0))} disabled={f === EMPTY}>
            Clear filters
          </Button>
        </Stack>
        {error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error.message}
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton variant="rounded" height={240} sx={{ m: 2 }} />
        ) : data.rows.length === 0 ? (
          <EmptyState title="No matching entries" body="Clear a filter or widen the date range." />
        ) : (
          <>
            <TableContainer>
              <Table size="small" aria-label="Audit entries">
                <TableHead>
                  <TableRow>
                    <TableCell>Time (UTC)</TableCell>
                    <TableCell>Actor</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Entity</TableCell>
                    <TableCell>Entity id</TableCell>
                    <TableCell>IP</TableCell>
                    <TableCell>
                      <Box component="span" sx={visuallyHidden}>
                        Details
                      </Box>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.id} hover data-testid="audit-row">
                      <TableCell>
                        <Mono>{r.at.replace('T', ' ').slice(0, 19)}</Mono>
                      </TableCell>
                      <TableCell>{r.actorName}</TableCell>
                      <TableCell>
                        <Mono>{r.action}</Mono>
                      </TableCell>
                      <TableCell>{r.entity}</TableCell>
                      <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <Mono>{r.entityId}</Mono>
                      </TableCell>
                      <TableCell>
                        <Mono>{r.ip ?? '—'}</Mono>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="small"
                          startIcon={<CompareArrowsOutlined />}
                          onClick={() => setOpen(r)}
                          aria-label={`View changes for ${r.action} at ${r.at}`}
                        >
                          Changes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={data.total}
              page={page}
              rowsPerPage={pageSize}
              rowsPerPageOptions={[25, 50, 100]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            />
          </>
        )}
      </Paper>
      <DiffDrawer row={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

const KIND_COLOR: Record<DiffKind, 'success' | 'error' | 'warning' | 'default'> = {
  added: 'success',
  removed: 'error',
  changed: 'warning',
  same: 'default',
};

function DiffDrawer({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
  const diff = row ? jsonDiff(row.before, row.after) : [];
  return (
    <Drawer
      anchor="right"
      open={Boolean(row)}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'audit-diff-title',
          sx: { width: { xs: '100%', sm: 520 }, p: 2.5 },
        },
      }}
    >
      {row && (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center">
            <Typography variant="h3" component="h2" id="audit-diff-title" sx={{ flex: 1 }}>
              <Mono>{row.action}</Mono>
            </Typography>
            <IconButton aria-label="Close" onClick={onClose}>
              <Close />
            </IconButton>
          </Stack>
          <Typography variant="body2">
            {row.actorName} · {row.entity} <Mono>{row.entityId}</Mono> · <Mono>{row.at}</Mono>
            {row.ip && (
              <>
                {' '}
                · from <Mono>{row.ip}</Mono>
              </>
            )}
          </Typography>
          {diff.length === 0 ? (
            <Typography color="text.secondary">No before/after data recorded.</Typography>
          ) : (
            <Table size="small" aria-label="Before and after">
              <TableHead>
                <TableRow>
                  <TableCell>Field</TableCell>
                  <TableCell>Before</TableCell>
                  <TableCell>After</TableCell>
                  <TableCell>Change</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {diff.map((d) => (
                  <TableRow key={d.path}>
                    <TableCell>
                      <Mono>{d.path}</Mono>
                    </TableCell>
                    <TableCell sx={{ wordBreak: 'break-word' }}>{showValue(d.before)}</TableCell>
                    <TableCell sx={{ wordBreak: 'break-word' }}>{showValue(d.after)}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" color={KIND_COLOR[d.kind]} label={d.kind} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Box>
            <Typography variant="subtitle2">Raw JSON</Typography>
            <Box
              component="pre"
              sx={{ fontSize: 12, overflowX: 'auto', bgcolor: 'action.hover', p: 1.5, borderRadius: 2 }}
            >
              {JSON.stringify({ before: row.before ?? null, after: row.after ?? null }, null, 2)}
            </Box>
          </Box>
        </Stack>
      )}
    </Drawer>
  );
}
