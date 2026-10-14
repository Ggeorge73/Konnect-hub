'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  MenuItem,
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
  Tooltip,
  Typography,
} from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useProjects } from '@/lib/client/api';
import { ACCEPTED_LOCKED, type WorkflowStatus } from '@/lib/domain/admin';
import { DEFAULT_STATUSES } from '@/lib/domain/workflow';
import { EmptyState, Mono } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useSaveWorkflow, useWorkflow } from './api';

interface Row {
  id: WorkflowStatus['id'];
  label: string;
  wip: string;
}
const toRows = (w: WorkflowStatus[]): Row[] =>
  w.map((s) => ({ id: s.id, label: s.label, wip: s.wipLimit ? String(s.wipLimit) : '' }));

/**
 * /admin/workflows (ADM-01): per project, rename the board's columns and set WIP limits. The
 * seven statuses and their order are fixed, and Accepted (client-only) can't be renamed or limited.
 */
export function WorkflowsAdmin() {
  const { data: projects = [], isLoading } = useProjects();
  const [key, setKey] = useState('');
  useEffect(() => {
    if (!key && projects.length) setKey(projects[0].key);
  }, [key, projects]);
  return (
    <AdminPage
      title="Workflows"
      intro="Rename board columns and set WIP limits per project. A column turns amber on the board when it is over its limit."
    >
      <Paper sx={{ borderRadius: 4, p: 2 }}>
        {isLoading ? (
          <Skeleton variant="rounded" height={48} />
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="Create a project first; each project has its own workflow."
          />
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              select
              label="Project to configure"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              sx={{ minWidth: 280 }}
            >
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.key}>
                  {p.key} · {p.name}
                </MenuItem>
              ))}
            </TextField>
            {key && (
              <Button component={Link} href={`/projects/${key}/board`}>
                Open board
              </Button>
            )}
          </Stack>
        )}
      </Paper>
      {key && <WorkflowEditor key={key} projectKey={key} />}
    </AdminPage>
  );
}

function WorkflowEditor({ projectKey }: { projectKey: string }) {
  const { data, isLoading, error } = useWorkflow(projectKey);
  const save = useSaveWorkflow(projectKey);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (data) setRows(toRows(data));
  }, [data]);
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !rows) return <Skeleton variant="rounded" height={320} />;
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const submit = (list: Row[]) =>
    save.mutate(
      list.map((r) =>
        r.wip ? { id: r.id, label: r.label, wipLimit: Number(r.wip) } : { id: r.id, label: r.label },
      ),
      { onSuccess: () => setNote(`Workflow for ${projectKey} saved. The board uses it now.`) },
    );

  return (
    <Paper sx={{ borderRadius: 4 }} component="section" aria-label={`Workflow for ${projectKey}`}>
      <TableContainer>
        <Table size="small" aria-label="Columns">
          <TableHead>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>Column name</TableCell>
              <TableCell>WIP limit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => {
              const locked = r.id === 'accepted';
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <Mono>{r.id}</Mono>
                      {locked && (
                        <Tooltip title={ACCEPTED_LOCKED}>
                          <LockOutlined fontSize="small" color="warning" aria-label="Fixed status" />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={r.label}
                      disabled={locked}
                      onChange={(e) => set(i, { label: e.target.value })}
                      slotProps={{ htmlInput: { 'aria-label': `Name for ${r.id}`, maxLength: 40 } }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="number"
                      placeholder="None"
                      value={r.wip}
                      disabled={locked}
                      onChange={(e) => set(i, { wip: e.target.value })}
                      slotProps={{ htmlInput: { 'aria-label': `WIP limit for ${r.id}`, min: 1, max: 999 } }}
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack spacing={1} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {ACCEPTED_LOCKED}
        </Typography>
        {save.error && <Alert severity="error">{save.error.message}</Alert>}
        <SavedNote text={note} />
        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={() => submit(rows)} disabled={save.isPending}>
            Save workflow
          </Button>
          <Button
            onClick={() => {
              const d = toRows(DEFAULT_STATUSES);
              setRows(d);
              submit(d);
            }}
            disabled={save.isPending}
          >
            Reset to default
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
