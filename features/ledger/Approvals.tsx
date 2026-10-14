'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { formatMoney } from '@/lib/domain/evm';
import type { ApprovalGroup } from '@/lib/domain/ledger';
import { EmptyState, ItemKey, Mono } from '@/components/ui/bits';
import { ExportMenu } from '@/features/exports/ExportMenu';
import { formatHours, useApprovals, useDecideTime } from './api';

/**
 * Lead approval of submitted time (TIME-01): submitted entries on the Lead's projects (Admins:
 * every project), grouped by person and ISO week. Approve or reject with a reason; approved time
 * is locked. Cost columns only appear for Admins (the API never sends cost to Leads).
 */
export function Approvals() {
  const { data, isLoading, error } = useApprovals();
  const [rejecting, setRejecting] = useState<ApprovalGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h1">Time approvals</Typography>
          <Typography color="text.secondary">
            Submitted time on your projects, by person and week. Approved time is locked and counts as actual
            cost.
          </Typography>
        </Box>
        <Button component={Link} href="/timesheet" startIcon={<ArrowBack />}>
          My timesheet
        </Button>
        <ExportMenu entity="time" label="Export approved time" />
      </Stack>
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error ? (
        <Alert severity="error">{error.message}</Alert>
      ) : isLoading || !data ? (
        <Skeleton variant="rounded" height={240} />
      ) : data.length === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="Nothing waiting for approval"
            body="Submitted weeks from your team show up here."
            action={
              <Button component={Link} href="/timesheet" variant="outlined">
                Open my timesheet
              </Button>
            }
          />
        </Paper>
      ) : (
        data.map((g) => (
          <ApprovalCard key={g.key} group={g} onReject={() => setRejecting(g)} onDone={setNotice} />
        ))
      )}
      <RejectDialog group={rejecting} onClose={() => setRejecting(null)} onDone={setNotice} />
    </Stack>
  );
}

function ApprovalCard({
  group: g,
  onReject,
  onDone,
}: {
  group: ApprovalGroup;
  onReject: () => void;
  onDone: (m: string) => void;
}) {
  const decide = useDecideTime();
  const headingId = `appr-${g.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const showCost = g.entries.some((e) => e.costCents !== undefined);
  const cost = g.entries.reduce((s, e) => s + (e.costCents ?? 0), 0);
  return (
    <Paper sx={{ borderRadius: 4 }} component="section" aria-labelledby={headingId}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 2, flexWrap: 'wrap' }} useFlexGap>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h3" component="h2" id={headingId}>
            {g.userName} — {g.week}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Week of <Mono>{g.weekStart}</Mono> · <Mono>{formatHours(g.hours)}</Mono>
            {showCost && (
              <>
                {' '}
                · cost <Mono>{formatMoney(cost)}</Mono>
              </>
            )}
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="success"
          startIcon={<CheckCircleOutline />}
          disabled={decide.isPending}
          onClick={() =>
            decide.mutate(
              { ids: g.entries.map((e) => e.id), decision: 'approved' },
              { onSuccess: (r) => onDone(`Approved ${r.length} entries for ${g.userName}.`) },
            )
          }
        >
          Approve
        </Button>
        <Button variant="outlined" color="error" startIcon={<UndoOutlined />} onClick={onReject}>
          Reject
        </Button>
      </Stack>
      {decide.error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {decide.error.message}
        </Alert>
      )}
      <TableContainer>
        <Table size="small" aria-label={`Time submitted by ${g.userName} for ${g.week}`}>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Project</TableCell>
              <TableCell>Item</TableCell>
              <TableCell align="right">Hours</TableCell>
              <TableCell>Billable</TableCell>
              <TableCell>Note</TableCell>
              {showCost && <TableCell align="right">Cost</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {g.entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <Mono>{e.date}</Mono>
                </TableCell>
                <TableCell>
                  <Mono>{e.projectKey}</Mono>
                </TableCell>
                <TableCell>
                  {e.itemKey && <ItemKey k={e.itemKey} />} {e.itemTitle}
                </TableCell>
                <TableCell align="right">
                  <Mono>{formatHours(e.hours)}</Mono>
                </TableCell>
                <TableCell>{e.billable ? 'Yes' : 'No'}</TableCell>
                <TableCell>{e.note}</TableCell>
                {showCost && (
                  <TableCell align="right">
                    <Mono>{formatMoney(e.costCents ?? null)}</Mono>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function RejectDialog({
  group,
  onClose,
  onDone,
}: {
  group: ApprovalGroup | null;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const decide = useDecideTime();
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    decide.reset();
    onClose();
  };
  return (
    <Dialog open={Boolean(group)} onClose={close} aria-labelledby="reject-time-title" fullWidth maxWidth="sm">
      <DialogTitle id="reject-time-title">Send time back</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {group?.userName} will see your reason on their timesheet, fix the entries and submit again.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          required
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {decide.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {decide.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!reason.trim() || decide.isPending}
          onClick={() =>
            group &&
            decide.mutate(
              { ids: group.entries.map((e) => e.id), decision: 'rejected', reason: reason.trim() },
              {
                onSuccess: (r) => {
                  onDone(`Sent ${r.length} entries back to ${group.userName}.`);
                  close();
                },
              },
            )
          }
        >
          Reject
        </Button>
      </DialogActions>
    </Dialog>
  );
}
