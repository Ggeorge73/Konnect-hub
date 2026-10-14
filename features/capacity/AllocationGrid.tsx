'use client';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Popover,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AMBER_ABOVE,
  LOAD_LABEL,
  weekLabel,
  type CapacityGrid,
  type GridCell,
  type GridRow,
} from '@/lib/domain/capacity';
import { EmptyState, Mono } from '@/components/ui/bits';
import { MONO } from '@/lib/theme';
import { useGrid, useSetAllocation } from './api';
import { LOAD_COLOR, LOAD_ICON } from './CapacityChips';
import { PeopleTabs } from './PeopleDirectory';

const fmtWeek = (w: string) =>
  new Date(`${w}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Arrow keys move between grid cells (row = person, column = week). */
function moveFocus(e: React.KeyboardEvent<HTMLElement>, row: number, col: number) {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const d = delta[e.key];
  if (!d) return;
  const next = document.querySelector<HTMLElement>(`[data-cell="${row + d[0]}:${col + d[1]}"]`);
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

function CellEditor({
  anchor,
  grid,
  row,
  cell,
  onClose,
}: {
  anchor: HTMLElement | null;
  grid: CapacityGrid;
  row: GridRow;
  cell: GridCell;
  onClose: () => void;
}) {
  const save = useSetAllocation();
  // Editable projects: the viewer manages them and the person is staffed there or has hours this week.
  const editable = grid.projects.filter(
    (p) =>
      p.editable && (row.person.memberOf.includes(p.id) || cell.projects.some((c) => c.projectId === p.id)),
  );
  const initial = Object.fromEntries(
    editable.map((p) => [p.id, String(cell.projects.find((c) => c.projectId === p.id)?.hours ?? 0)]),
  );
  const [hours, setHours] = useState<Record<string, string>>(initial);
  const submit = async () => {
    for (const p of editable) {
      if (hours[p.id] === initial[p.id]) continue;
      await save.mutateAsync({
        projectId: p.id,
        userId: row.person.id,
        week: cell.week,
        hours: Number(hours[p.id] || 0),
      });
    }
    onClose();
  };
  return (
    <Popover
      open={Boolean(anchor)}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 2, width: 280 } } }}
    >
      <Stack
        spacing={1.5}
        component="form"
        aria-label={`Edit hours: ${row.person.name}, ${weekLabel(cell.week)}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Typography variant="h3">
          {row.person.name} · {weekLabel(cell.week)}
        </Typography>
        {save.error && (
          <Alert severity="error" role="alert">
            {save.error.message}
          </Alert>
        )}
        {editable.map((p, i) => (
          <TextField
            key={p.id}
            size="small"
            type="number"
            label={`${p.key} hours`}
            value={hours[p.id]}
            autoFocus={i === 0}
            onChange={(e) => setHours((h) => ({ ...h, [p.id]: e.target.value }))}
            slotProps={{ htmlInput: { min: 0, max: 80, step: 0.5 } }}
          />
        ))}
        {cell.otherHours > 0 && (
          <Typography variant="body2" color="text.secondary">
            Plus <Mono>{cell.otherHours} h</Mono> on other projects.
          </Typography>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>
            Save hours
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
}

function Cell({
  grid,
  row,
  cell,
  r,
  c,
}: {
  grid: CapacityGrid;
  row: GridRow;
  cell: GridCell;
  r: number;
  c: number;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const canEdit = grid.projects.some(
    (p) =>
      p.editable && (row.person.memberOf.includes(p.id) || cell.projects.some((x) => x.projectId === p.id)),
  );
  const Icon = LOAD_ICON[cell.level];
  const label = `${cell.pct}% · ${row.person.name}, ${weekLabel(cell.week)}: ${cell.hours} of ${row.person.hoursPerWeek} hours, ${LOAD_LABEL[cell.level]}`;
  const content = (
    <Stack spacing={0.25} alignItems="flex-start" sx={{ width: '100%' }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Icon sx={{ fontSize: 14, color: LOAD_COLOR[cell.level] }} aria-hidden />
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 700 }}>
          {cell.pct}%
        </Typography>
      </Stack>
      {cell.projects.map((p) => (
        <Typography key={p.projectId} component="span" sx={{ fontFamily: MONO, fontSize: 11 }}>
          {p.projectKey} {p.hours}h
        </Typography>
      ))}
      {cell.otherHours > 0 && (
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 11 }}>
          Other {cell.otherHours}h
        </Typography>
      )}
    </Stack>
  );
  return (
    <TableCell
      sx={{
        p: 0.5,
        verticalAlign: 'top',
        bgcolor: cell.level === 'ok' ? undefined : alpha(LOAD_COLOR[cell.level], 0.16),
        borderLeft: cell.level === 'ok' ? undefined : `3px solid ${LOAD_COLOR[cell.level]}`,
      }}
      data-level={cell.level}
      data-testid={`cell-${row.person.id}-${cell.week}`}
    >
      <Box
        component="button"
        type="button"
        data-cell={`${r}:${c}`}
        aria-label={label}
        aria-haspopup={canEdit ? 'dialog' : undefined}
        title={label}
        onKeyDown={(e) => moveFocus(e, r, c)}
        onClick={(e) => canEdit && setAnchor(e.currentTarget)}
        sx={{
          all: 'unset',
          boxSizing: 'border-box',
          display: 'block',
          width: '100%',
          minHeight: 44,
          p: 0.75,
          borderRadius: 1,
          cursor: canEdit ? 'pointer' : 'default',
          color: 'text.primary',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'secondary.main' },
        }}
      >
        {content}
      </Box>
      {anchor && (
        <CellEditor anchor={anchor} grid={grid} row={row} cell={cell} onClose={() => setAnchor(null)} />
      )}
    </TableCell>
  );
}

export function AllocationGrid() {
  const { data, isLoading, error } = useGrid();
  return (
    <Box>
      <PeopleTabs />
      <Paper sx={{ p: 2, borderRadius: 4, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Hours per person and ISO week for the next 12 weeks. Cells turn amber above {AMBER_ABOVE}% and red
          above 100% of weekly capacity. Delivery Leads edit hours on their own projects; Admins on every
          project. Use the arrow keys to move between cells and Enter to edit.
        </Typography>
      </Paper>
      {error && <Alert severity="error">{error.message}</Alert>}
      {isLoading && <Skeleton variant="rounded" height={320} />}
      {data && !data.rows.length && (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="No one to plan yet"
            body="Add people to the directory to see their allocations."
          />
        </Paper>
      )}
      {data && data.rows.length > 0 && (
        <Paper sx={{ borderRadius: 4, overflowX: 'auto' }}>
          <Table size="small" aria-label="Allocation grid" sx={{ minWidth: 1100 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 180 }}>Person</TableCell>
                {data.weeks.map((w) => (
                  <TableCell key={w} sx={{ minWidth: 84 }}>
                    <Mono>{weekLabel(w)}</Mono>
                    <Typography variant="caption" display="block" color="text.secondary">
                      {fmtWeek(w)}
                    </Typography>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.rows.map((row, r) => (
                <TableRow key={row.person.id}>
                  <TableCell component="th" scope="row">
                    <Typography fontWeight={600} variant="body2">
                      {row.person.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.person.title} · <Mono>{row.person.hoursPerWeek} h/wk</Mono>
                    </Typography>
                  </TableCell>
                  {row.cells.map((cell, c) => (
                    <Cell key={cell.week} grid={data} row={row} cell={cell} r={r} c={c} />
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  );
}
