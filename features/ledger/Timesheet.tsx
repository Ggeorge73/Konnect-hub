'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import SendOutlined from '@mui/icons-material/SendOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import {
  addDays,
  hoursError,
  isEditable,
  isoWeekLabel,
  isoWeekStart,
  timesheetGrid,
  type TimesheetCell,
  type TimesheetRow,
} from '@/lib/domain/ledger';
import { EmptyState, ItemKey, Mono } from '@/components/ui/bits';
import { ExportMenu } from '@/features/exports/ExportMenu';
import {
  formatHours,
  localToday,
  useDeleteTime,
  useLogTime,
  useSubmitWeek,
  useUpdateTime,
  useWeek,
} from './api';
import { TimeStatusChip } from './TimeStatusChip';

export interface LoggableItem {
  id: string;
  key: string;
  title: string;
  projectKey: string;
}

const dayFmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/**
 * Weekly timesheet (TIME-01): rows are item × day for one ISO week. Cells edit inline (a cell
 * with one draft or rejected entry is updated, an empty cell creates an entry, clearing a cell
 * deletes it). "Submit week" sends every draft of the week to the Lead for approval.
 */
export function Timesheet({
  items,
  canApprove,
  initialWeek,
}: {
  items: LoggableItem[];
  canApprove: boolean;
  /** Monday of the current week, computed on the server so the first render matches. */
  initialWeek: string;
}) {
  const [week, setWeek] = useState(initialWeek);
  const { data: entries, isLoading, error } = useWeek(week);
  const [extra, setExtra] = useState<Record<string, LoggableItem[]>>({});
  const submit = useSubmitWeek();
  const [done, setDone] = useState<string | null>(null);

  const grid = useMemo(
    () =>
      timesheetGrid(
        entries ?? [],
        week,
        (extra[week] ?? []).map((i) => ({
          projectKey: i.projectKey,
          itemId: i.id,
          itemKey: i.key,
          itemTitle: i.title,
        })),
      ),
    [entries, week, extra],
  );
  const drafts = (entries ?? []).filter((e) => e.status === 'draft').length;
  const rejected = (entries ?? []).filter((e) => e.status === 'rejected');
  const shown = new Set(grid.rows.map((r) => r.itemId));
  const go = (w: string) => {
    setWeek(w);
    setDone(null);
    submit.reset();
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h1">Timesheet</Typography>
          <Typography color="text.secondary">
            Log hours per item and day, then submit the week for your Lead’s approval. Approved time is locked
            and becomes project actual cost.
          </Typography>
        </Box>
        {canApprove && (
          <Button component={Link} href="/timesheet/approvals" startIcon={<FactCheckOutlined />}>
            Approvals
          </Button>
        )}
        <ExportMenu entity="timesheet" params={{ week }} />
      </Stack>

      <Paper sx={{ borderRadius: 4 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ p: 2, flexWrap: 'wrap' }}
          useFlexGap
          component="nav"
          aria-label="Week"
        >
          <IconButton aria-label="Previous week" onClick={() => go(addDays(week, -7))}>
            <ChevronLeft />
          </IconButton>
          <Typography variant="h3" component="h2" aria-live="polite" data-testid="timesheet-week">
            Week of {dayFmt(week, { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
            <Typography component="span" color="text.secondary">
              ({isoWeekLabel(week)})
            </Typography>
          </Typography>
          <IconButton aria-label="Next week" onClick={() => go(addDays(week, 7))}>
            <ChevronRight />
          </IconButton>
          <Button size="small" onClick={() => go(isoWeekStart(localToday()))}>
            This week
          </Button>
          <Box sx={{ flex: 1 }} />
          <Autocomplete
            size="small"
            sx={{ width: 320, maxWidth: '100%' }}
            options={items.filter((i) => !shown.has(i.id))}
            getOptionLabel={(i) => `${i.key} ${i.title}`}
            value={null}
            onChange={(_, v) => v && setExtra((x) => ({ ...x, [week]: [...(x[week] ?? []), v] }))}
            renderInput={(p) => <TextField {...p} label="Add a work item row" />}
          />
          <Button
            variant="contained"
            startIcon={<SendOutlined />}
            disabled={drafts === 0 || submit.isPending}
            onClick={() =>
              submit.mutate(week, {
                onSuccess: (r) => setDone(`Submitted ${r.length} entries for approval.`),
              })
            }
          >
            Submit week
          </Button>
        </Stack>
        {done && (
          <Alert severity="success" sx={{ mx: 2, mb: 2 }}>
            {done}
          </Alert>
        )}
        {submit.error && (
          <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
            {submit.error.message}
          </Alert>
        )}
        {rejected.length > 0 && (
          <Alert severity="warning" sx={{ mx: 2, mb: 2 }}>
            {rejected.length} {rejected.length === 1 ? 'entry was' : 'entries were'} sent back:{' '}
            {rejected.map((e) => `${e.itemKey ?? e.projectKey} ${e.date}: “${e.rejectReason}”`).join('; ')}.
            Edit them and submit the week again.
          </Alert>
        )}
        {error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error.message}
          </Alert>
        ) : isLoading ? (
          <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />
        ) : grid.rows.length === 0 ? (
          <EmptyState
            title="No time this week"
            body="Add a work item row above, or log time from an item’s side panel."
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label={`Timesheet for the week of ${week}`}>
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  {grid.days.map((d) => (
                    <TableCell key={d} align="center">
                      {dayFmt(d, { weekday: 'short' })}
                      <br />
                      <Mono>{dayFmt(d, { month: 'numeric', day: 'numeric' })}</Mono>
                    </TableCell>
                  ))}
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {grid.rows.map((r) => (
                  <TableRow key={r.key} data-testid={`ts-row-${r.itemKey}`}>
                    <TableCell sx={{ minWidth: 200 }}>
                      {r.itemKey && <ItemKey k={r.itemKey} />}{' '}
                      <Typography component="span" variant="body2">
                        {r.itemTitle}
                      </Typography>
                    </TableCell>
                    {r.cells.map((c) => (
                      <TableCell key={c.date} align="center" sx={{ px: 0.5 }}>
                        <CellEditor row={r} cell={c} />
                      </TableCell>
                    ))}
                    <TableCell align="right">
                      <Mono>{formatHours(r.total)}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  {grid.dayTotals.map((t, i) => (
                    <TableCell key={grid.days[i]} align="center">
                      <Mono>{t ? formatHours(t) : '—'}</Mono>
                    </TableCell>
                  ))}
                  <TableCell align="right" data-testid="timesheet-total">
                    <Mono>{formatHours(grid.total)}</Mono>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
        {(entries ?? []).length > 0 && (
          <Stack direction="row" spacing={1} sx={{ p: 2 }} flexWrap="wrap" useFlexGap aria-label="Status">
            {(['draft', 'submitted', 'approved', 'rejected'] as const).map((st) => {
              const n = (entries ?? []).filter((e) => e.status === st).length;
              return n ? (
                <Stack key={st} direction="row" spacing={0.5} alignItems="center">
                  <TimeStatusChip status={st} />
                  <Mono>{n}</Mono>
                </Stack>
              ) : null;
            })}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function CellEditor({ row, cell }: { row: TimesheetRow; cell: TimesheetCell }) {
  const log = useLogTime();
  const update = useUpdateTime();
  const del = useDeleteTime();
  const [err, setErr] = useState<string | null>(null);
  const label = `${row.itemKey ?? row.projectKey} ${dayFmt(cell.date, { weekday: 'long', month: 'short', day: 'numeric' })} hours`;
  const only = cell.entries.length === 1 ? cell.entries[0] : null;
  const editable = cell.entries.length === 0 || (only !== null && isEditable(only));

  if (!editable) {
    const locked = cell.entries.some((e) => e.status === 'approved');
    const status = cell.entries.every((e) => e.status === cell.entries[0].status)
      ? cell.entries[0].status
      : null;
    return (
      <Tooltip
        title={
          cell.entries.length > 1
            ? 'Several entries: edit them from the item panel'
            : locked
              ? 'Approved and locked'
              : 'Submitted, waiting for approval'
        }
      >
        <Stack
          alignItems="center"
          spacing={0.25}
          tabIndex={0}
          aria-label={`${label}: ${formatHours(cell.hours)}`}
        >
          <Mono>
            {locked && <LockOutlined sx={{ fontSize: 12, mr: 0.25, verticalAlign: 'middle' }} aria-hidden />}
            {formatHours(cell.hours)}
          </Mono>
          {status && <TimeStatusChip status={status} />}
        </Stack>
      </Tooltip>
    );
  }

  const save = (raw: string) => {
    const v = raw.trim() === '' ? 0 : Number(raw);
    if (v === cell.hours) return setErr(null);
    if (v !== 0) {
      const e = hoursError(v);
      if (e) return setErr(e);
    }
    setErr(null);
    const onError = (e: Error) => setErr(e.message);
    if (!only) {
      if (v > 0 && row.itemId) log.mutate({ itemId: row.itemId, date: cell.date, hours: v }, { onError });
    } else if (v === 0) del.mutate(only.id, { onError });
    else update.mutate({ id: only.id, patch: { hours: v } }, { onError });
  };

  return (
    <Stack alignItems="center" spacing={0.25}>
      <TextField
        key={`${cell.hours}`}
        size="small"
        type="number"
        defaultValue={cell.hours || ''}
        placeholder="0"
        error={Boolean(err)}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        slotProps={{
          htmlInput: {
            step: 0.25,
            min: 0,
            max: 24,
            inputMode: 'decimal',
            'aria-label': label,
            'aria-invalid': Boolean(err),
            title: err ?? undefined,
            style: { textAlign: 'center', width: 52, padding: '6px 4px' },
          },
        }}
      />
      {only && only.status === 'rejected' && <TimeStatusChip status="rejected" />}
      {err && (
        <Typography variant="caption" color="error" role="alert">
          {err}
        </Typography>
      )}
    </Stack>
  );
}
