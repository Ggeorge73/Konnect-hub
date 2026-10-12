'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import type { Phase, Sprint, WorkItem } from '@/lib/domain/types';
import {
  defaultPhaseId,
  nextPlannedSprint,
  suggestSprintDates,
  validateSprint,
  type CarryOver,
  type SprintInput,
} from '@/lib/domain/sprints';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { ItemKey } from '@/components/ui/bits';

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CreateSprintDialog({
  open,
  onClose,
  onCreate,
  phases,
  sprints,
  projectKey,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: SprintInput) => void;
  phases: Phase[];
  sprints: Sprint[];
  projectKey: string;
  busy: boolean;
  error?: string | null;
}) {
  const initial = (): SprintInput & { capacity: string } => {
    const dates = suggestSprintDates(sprints, todayIso());
    return {
      name: `${projectKey} Sprint ${sprints.length + 1}`,
      phaseId: defaultPhaseId(phases) ?? '',
      ...dates,
      goal: '',
      capacity: '',
    };
  };
  const [form, setForm] = useState(initial);
  const [touched, setTouched] = useState(false);
  const capacityHours = form.capacity.trim() === '' ? null : Number(form.capacity);
  const errors = validateSprint({ ...form, capacityHours });
  if (!form.phaseId) errors.push('Choose a phase.');
  const endError = errors.find((e) => e.startsWith('End'));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ transition: { onEnter: () => (setForm(initial()), setTouched(false)) } }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (errors.length) return;
          const { capacity: _c, ...rest } = form;
          onCreate({ ...rest, capacityHours });
        }}
        noValidate
      >
        <DialogTitle>Create sprint</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField label="Sprint name" fullWidth required value={form.name} onChange={set('name')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField select label="Phase" fullWidth value={form.phaseId} onChange={set('phaseId')}>
                {phases.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.gate}. {p.name}
                    {p.status === 'active' ? ' (active)' : ''}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Start date"
                type="date"
                fullWidth
                value={form.startDate}
                onChange={set('startDate')}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="End date"
                type="date"
                fullWidth
                value={form.endDate}
                onChange={set('endDate')}
                error={Boolean(endError)}
                helperText={endError ?? ' '}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField label="Sprint goal" fullWidth value={form.goal} onChange={set('goal')} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Capacity (hours)"
                type="number"
                fullWidth
                value={form.capacity}
                onChange={set('capacity')}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Grid>
          </Grid>
          {touched && errors.length > 0 && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errors.join(' ')}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Create sprint
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function CompleteSprintDialog({
  sprint,
  sprints,
  items,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  sprint: Sprint | null;
  sprints: Sprint[];
  items: WorkItem[];
  onClose: () => void;
  onConfirm: (carryOver: CarryOver) => void;
  busy: boolean;
  error?: string | null;
}) {
  const next = sprint ? nextPlannedSprint(sprint, sprints) : null;
  const [choice, setChoice] = useState<CarryOver>('next');
  const unfinished = items.filter((i) => i.status !== 'done' && i.status !== 'accepted');
  const effective: CarryOver = next ? choice : 'backlog';
  return (
    <Dialog
      open={Boolean(sprint)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ transition: { onEnter: () => setChoice('next') } }}
    >
      <DialogTitle>Complete {sprint?.name}</DialogTitle>
      <DialogContent>
        {unfinished.length === 0 ? (
          <Typography>All work in this sprint is done or accepted.</Typography>
        ) : (
          <Stack spacing={2}>
            <Typography>
              {unfinished.length} item{unfinished.length === 1 ? ' is' : 's are'} not done or accepted:
            </Typography>
            <List dense aria-label="Unfinished items" sx={{ maxHeight: 220, overflowY: 'auto' }}>
              {unfinished.map((i) => (
                <ListItem key={i.id} disableGutters>
                  <ListItemText
                    primary={
                      <>
                        <ItemKey k={i.key} /> {i.title}
                      </>
                    }
                    secondary={STATUS_LABEL[i.status]}
                  />
                </ListItem>
              ))}
            </List>
            <FormControl>
              <FormLabel id="carry-over-label">Move unfinished work to</FormLabel>
              <RadioGroup
                aria-labelledby="carry-over-label"
                value={effective}
                onChange={(e) => setChoice(e.target.value as CarryOver)}
              >
                <FormControlLabel
                  value="next"
                  control={<Radio />}
                  disabled={!next}
                  label={next ? `Next planned sprint: ${next.name}` : 'Next planned sprint (none planned)'}
                />
                <FormControlLabel value="backlog" control={<Radio />} label="Backlog" />
              </RadioGroup>
            </FormControl>
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy} onClick={() => onConfirm(effective)}>
          Complete sprint
        </Button>
      </DialogActions>
    </Dialog>
  );
}
