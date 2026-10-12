'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined';
import PersonRemoveOutlined from '@mui/icons-material/PersonRemoveOutlined';
import { hoursForPct } from '@/lib/domain/capacity';
import type { AssignmentPreview, ProjectTeam } from '@/lib/data/capacity';
import { EmptyState, Mono } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { previewAssignment, useAssign, useRemoveMember, useSetRestricted, useTeam } from './api';
import { RestrictedChip } from './CapacityChips';

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function AssignDialog({
  open,
  team,
  initialUserId,
  onClose,
  onDone,
}: {
  open: boolean;
  team: ProjectTeam;
  initialUserId?: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const key = team.project.key;
  const assign = useAssign(key);
  const current = team.members.find((m) => m.userId === initialUserId);
  const [userId, setUserId] = useState(initialUserId ?? '');
  const [role, setRole] = useState(current?.projectRole ?? '');
  const [pct, setPct] = useState(String(current?.allocationPct ?? 50));
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const person = team.candidates.find((c) => c.id === userId);

  useEffect(() => {
    const n = Number(pct);
    if (!userId || !Number.isInteger(n) || n < 0 || n > 100) {
      setPreview(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      previewAssignment(key, { userId, allocationPct: n })
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, userId, pct]);

  const submit = () =>
    assign.mutate(
      { userId, projectRole: role, allocationPct: Number(pct) },
      {
        onSuccess: (r) => {
          onDone(r.summary ? `Assigned. ${r.summary}` : `${person?.name ?? 'Person'} assigned to ${key}.`);
          onClose();
        },
      },
    );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="assign-title">
      <DialogTitle id="assign-title">Assign to {key}</DialogTitle>
      <DialogContent>
        <Stack
          spacing={2}
          sx={{ pt: 1 }}
          component="form"
          id="assign-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {assign.error && (
            <Alert severity="error" role="alert">
              {assign.error.message}
            </Alert>
          )}
          <TextField
            select
            label="Person"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              assign.reset();
              const m = team.members.find((x) => x.userId === e.target.value);
              if (m) {
                setRole(m.projectRole);
                setPct(String(m.allocationPct));
              }
            }}
            required
          >
            {team.candidates.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
                {c.title ? ` · ${c.title}` : ''}
                {team.project.restricted && !c.usPerson ? ' (non-U.S.)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Project role" value={role} onChange={(e) => setRole(e.target.value)} required />
          <TextField
            label="Allocation %"
            type="number"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            required
            slotProps={{ htmlInput: { min: 0, max: 100, step: 5 } }}
            helperText={
              person
                ? `${hoursForPct(person.hoursPerWeek, Number(pct) || 0)} of ${person.hoursPerWeek} h/week, seeded across the project window (next 12 weeks).`
                : 'Share of the person’s weekly capacity.'
            }
          />
          {preview?.refusal && (
            <Alert severity="error" role="status">
              {preview.refusal}
            </Alert>
          )}
          {!preview?.refusal && preview?.summary && (
            <Alert
              severity={preview.warnings.some((w) => w.level === 'red') ? 'error' : 'warning'}
              role="status"
            >
              {preview.summary} You can still assign; consider adjusting other allocations.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          form="assign-form"
          variant="contained"
          disabled={assign.isPending || !userId || !role}
        >
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function TeamTab() {
  const { project } = useProjectBundle();
  const { data: team, isLoading, error } = useTeam(project.key);
  const remove = useRemoveMember(project.key);
  const restrict = useSetRestricted(project.key);
  const [dialog, setDialog] = useState<{ userId?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !team) return <Skeleton variant="rounded" height={240} />;
  const showUs = team.members.some((m) => m.usPerson !== undefined);

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4 }} component="section" aria-labelledby="team-title">
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ md: 'center' }}
        sx={{ mb: 2 }}
      >
        <Typography id="team-title" variant="h2">
          Team
        </Typography>
        {team.project.restricted && <RestrictedChip />}
        <Box sx={{ flex: 1 }} />
        {team.canManage && (
          <FormControlLabel
            control={
              <Switch
                checked={team.project.restricted}
                onChange={(e) => restrict.mutate(e.target.checked)}
                disabled={restrict.isPending}
              />
            }
            label="Restricted (U.S. persons only)"
          />
        )}
        {team.canManage && (
          <Button variant="contained" startIcon={<PersonAddAlt1Outlined />} onClick={() => setDialog({})}>
            Assign person
          </Button>
        )}
      </Stack>
      {restrict.error && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }} onClose={() => restrict.reset()}>
          {restrict.error.message}
        </Alert>
      )}
      {remove.error && (
        <Alert severity="error" role="alert" sx={{ mb: 2 }}>
          {remove.error.message}
        </Alert>
      )}
      {notice && (
        <Alert
          severity={/would be/.test(notice) ? 'warning' : 'success'}
          sx={{ mb: 2 }}
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}
      {!team.members.length ? (
        <EmptyState
          title="No one is staffed yet"
          body="Assign people with a role and allocation to plan this project's capacity."
          action={
            team.canManage ? (
              <Button variant="contained" onClick={() => setDialog({})}>
                Assign person
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={`${project.key} team`}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Project role</TableCell>
                <TableCell align="right">Allocation</TableCell>
                <TableCell align="right">Hours / week</TableCell>
                {showUs && <TableCell>U.S. person</TableCell>}
                {team.canManage && (
                  <TableCell align="right">
                    <Box component="span" sx={visuallyHidden}>
                      Actions
                    </Box>
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {team.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {m.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {m.title}
                    </Typography>
                  </TableCell>
                  <TableCell>{m.projectRole || '—'}</TableCell>
                  <TableCell align="right">
                    <Mono>{m.allocationPct}%</Mono>
                  </TableCell>
                  <TableCell align="right">
                    <Mono>{hoursForPct(m.hoursPerWeek, m.allocationPct)}</Mono>
                  </TableCell>
                  {showUs && (
                    <TableCell>
                      {m.usPerson ? (
                        'Yes'
                      ) : (
                        <Chip size="small" label="Non-U.S." sx={{ height: 22, fontSize: 11 }} />
                      )}
                    </TableCell>
                  )}
                  {team.canManage && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Button size="small" onClick={() => setDialog({ userId: m.userId })}>
                        Edit
                      </Button>
                      <Tooltip title={`Remove ${m.name}`}>
                        <IconButton
                          size="small"
                          aria-label={`Remove ${m.name} from ${project.key}`}
                          onClick={() => remove.mutate(m.userId)}
                        >
                          <PersonRemoveOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {dialog && (
        <AssignDialog
          open
          team={team}
          initialUserId={dialog.userId}
          onClose={() => setDialog(null)}
          onDone={setNotice}
        />
      )}
    </Paper>
  );
}
