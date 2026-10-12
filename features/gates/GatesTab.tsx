'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import type { GateCriterion, Phase, Profile } from '@/lib/domain/types';
import {
  canEditCriteria,
  checkExitCriteria,
  DECISION_LABEL,
  isWorkingPhase,
  type GateReview,
} from '@/lib/domain/gates';
import { useMe, usePeople } from '@/lib/client/api';
import { canSeeFinancials } from '@/lib/domain/permissions';
import { Mono } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useCriterionMutations, useGates, useRequestReview } from './api';
import { GatePackView } from './GatePackView';
import { PhaseStatusChip } from './PhaseStatusChip';

/** GATE-01 / GATE-02: the five phases, their exit criteria and the gate review flow. */
export function GatesTab() {
  const { project } = useProjectBundle();
  const { data, error, isLoading } = useGates(project.key);
  const { data: people = [] } = usePeople();
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data) return <Skeleton variant="rounded" height={320} />;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">Gates</Typography>
          <Typography variant="body2" color="text.secondary">
            Each phase closes with a client gate review. Tick exit criteria as they are met.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<PictureAsPdfOutlined />}
          href={`/api/projects/${project.key}/acceptance-record`}
          download
        >
          Download Acceptance Record
        </Button>
      </Stack>
      {data.phases.map((ph) => (
        <PhaseCard
          key={ph.id}
          projectKey={project.key}
          phase={ph}
          phases={data.phases}
          criteria={data.criteria.filter((c) => c.phaseId === ph.id)}
          reviews={data.reviews.filter((r) => r.phaseId === ph.id)}
          canManage={data.canManage}
          people={people}
        />
      ))}
    </Stack>
  );
}

function PhaseCard({
  projectKey,
  phase,
  phases,
  criteria,
  reviews,
  canManage,
  people,
}: {
  projectKey: string;
  phase: Phase;
  phases: Phase[];
  criteria: GateCriterion[];
  reviews: GateReview[];
  canManage: boolean;
  people: Profile[];
}) {
  const m = useCriterionMutations(projectKey);
  const [newText, setNewText] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? '—';
  const editable = canManage && canEditCriteria(phase).ok;
  const pending = reviews.find((r) => r.status === 'pending');
  const decided = reviews.filter((r) => r.status === 'decided');
  const lastDecision = decided.at(-1);
  const earlierOpen = phases.some(
    (p) => p.gate < phase.gate && !['approved', 'approved_with_conditions'].includes(p.status),
  );
  const mutationError = m.add.error ?? m.update.error ?? m.remove.error;
  const add = () => {
    if (!newText.trim()) return;
    m.add.mutate({ phaseId: phase.id, text: newText.trim() }, { onSuccess: () => setNewText('') });
  };
  return (
    <Paper
      component="section"
      aria-labelledby={`${phase.id}-title`}
      sx={{
        p: 2.5,
        borderRadius: 4,
        borderLeft: 4,
        borderLeftColor: isWorkingPhase(phase.status) ? 'primary.main' : 'transparent',
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="h3" id={`${phase.id}-title`}>
          Gate {phase.gate} · {phase.name}
        </Typography>
        <PhaseStatusChip status={phase.status} />
        {(phase.startDate || phase.endDate) && (
          <Typography variant="caption" color="text.secondary">
            <Mono>
              {phase.startDate ?? '…'} → {phase.endDate ?? '…'}
            </Mono>
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {canManage && isWorkingPhase(phase.status) && !pending && (
          <Button
            variant="contained"
            startIcon={<FactCheckOutlined />}
            onClick={() => setRequestOpen(true)}
            disabled={earlierOpen}
          >
            Mark ready for gate review
          </Button>
        )}
      </Stack>

      {isWorkingPhase(phase.status) && lastDecision?.decision === 'rejected' && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          Gate rejected by {name(lastDecision.decidedBy)} on{' '}
          {new Date(lastDecision.decidedAt!).toLocaleDateString()}: {lastDecision.reason}
        </Alert>
      )}
      {pending && (
        <Alert severity="info" variant="outlined" sx={{ mb: 1.5 }}>
          Ready for gate review since {new Date(pending.requestedAt).toLocaleString()}. Awaiting the Client
          Sponsor’s decision.
        </Alert>
      )}
      {mutationError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {mutationError.message}
        </Alert>
      )}

      <Typography variant="subtitle2">Exit criteria</Typography>
      {criteria.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No exit criteria yet.{editable ? ' Add the first one below.' : ''}
        </Typography>
      )}
      {criteria.map((c) => (
        <CriterionRow
          key={c.id}
          c={c}
          editable={editable}
          doneByName={name(c.doneBy)}
          onToggle={(done) => m.update.mutate({ id: c.id, done })}
          onRename={(text) => m.update.mutate({ id: c.id, text })}
          onRemove={() => m.remove.mutate(c.id)}
        />
      ))}
      {editable && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Add an exit criterion"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            slotProps={{ htmlInput: { 'aria-label': `New exit criterion for ${phase.name}` } }}
          />
          <Button onClick={add} disabled={m.add.isPending}>
            Add
          </Button>
        </Stack>
      )}

      {pending && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Gate pack
          </Typography>
          <GatePackView review={pending} people={people} />
        </Box>
      )}

      {decided.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="subtitle2" gutterBottom>
            Gate decisions
          </Typography>
          {decided.map((r) => (
            <Stack key={r.id} spacing={0.5} sx={{ mb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
                <Chip
                  size="small"
                  label={DECISION_LABEL[r.decision!]}
                  color={
                    r.decision === 'rejected' ? 'error' : r.decision === 'approved' ? 'success' : 'warning'
                  }
                />
                <Typography variant="body2">
                  {name(r.decidedBy)} · <Mono>{new Date(r.decidedAt!).toLocaleString()}</Mono> · IP{' '}
                  <Mono>{r.ip ?? '—'}</Mono>
                </Typography>
              </Stack>
              {r.conditions?.length ? (
                <Typography variant="body2" color="text.secondary">
                  Conditions: {r.conditions.join('; ')}
                  {r.conditionItemKeys?.length ? (
                    <>
                      {' '}
                      → tracked as <Mono>{r.conditionItemKeys.join(', ')}</Mono>
                    </>
                  ) : null}
                </Typography>
              ) : null}
              {r.reason && (
                <Typography variant="body2" color="text.secondary">
                  Reason: {r.reason}
                </Typography>
              )}
            </Stack>
          ))}
        </Box>
      )}
      <RequestReviewDialog
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projectKey={projectKey}
        phase={phase}
        criteria={criteria}
      />
    </Paper>
  );
}

function CriterionRow({
  c,
  editable,
  doneByName,
  onToggle,
  onRename,
  onRemove,
}: {
  c: GateCriterion;
  editable: boolean;
  doneByName: string;
  onToggle: (done: boolean) => void;
  onRename: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Local state so the tick responds instantly; re-synced when the server state changes.
  const [checked, setChecked] = useState(c.done);
  useEffect(() => setChecked(c.done), [c.done]);
  const [text, setText] = useState(c.text);
  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== c.text) onRename(text.trim());
    else setText(c.text);
  };
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.25 }}>
      <Checkbox
        checked={checked}
        disabled={!editable}
        onChange={(e) => {
          setChecked(e.target.checked);
          onToggle(e.target.checked);
        }}
        inputProps={{ 'aria-label': c.text }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setText(c.text);
                setEditing(false);
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': 'Criterion text' } }}
          />
        ) : (
          <>
            <Typography variant="body2">{c.text}</Typography>
            {c.done && c.doneAt && (
              <Typography variant="caption" color="text.secondary">
                Done by {doneByName} · <Mono>{new Date(c.doneAt).toLocaleString()}</Mono>
              </Typography>
            )}
          </>
        )}
      </Box>
      {editable && !editing && (
        <>
          <Tooltip title="Edit criterion">
            <IconButton size="small" aria-label={`Edit "${c.text}"`} onClick={() => setEditing(true)}>
              <EditOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove criterion">
            <IconButton size="small" aria-label={`Remove "${c.text}"`} onClick={onRemove}>
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}

function RequestReviewDialog({
  open,
  onClose,
  projectKey,
  phase,
  criteria,
}: {
  open: boolean;
  onClose: () => void;
  projectKey: string;
  phase: Phase;
  criteria: GateCriterion[];
}) {
  const request = useRequestReview(projectKey);
  const { data: me } = useMe();
  const [overrideNote, setOverrideNote] = useState('');
  const [summary, setSummary] = useState('');
  const [shareBudget, setShareBudget] = useState(false);
  const check = checkExitCriteria(criteria, overrideNote);
  const open_ = criteria.filter((c) => !c.done);
  const submit = () =>
    request.mutate(
      {
        phaseId: phase.id,
        overrideNote: overrideNote || undefined,
        summary: summary || undefined,
        shareBudget,
      },
      { onSuccess: onClose },
    );
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Ready for gate review: Gate {phase.gate} · {phase.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {open_.length === 0 ? (
            <Alert severity="success">All {criteria.length} exit criteria are complete.</Alert>
          ) : (
            <Alert severity="warning">
              {open_.length} exit {open_.length === 1 ? 'criterion is' : 'criteria are'} still open:{' '}
              {open_.map((c) => c.text).join('; ')}. Add an override note to request review anyway; it is
              recorded.
            </Alert>
          )}
          {open_.length > 0 && (
            <TextField
              label="Override note"
              required
              multiline
              minRows={2}
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              helperText="Why the gate should be reviewed with open criteria."
            />
          )}
          <TextField
            label="Summary for the sponsor (optional)"
            multiline
            minRows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            helperText="Leave blank to use the generated summary."
          />
          {me && canSeeFinancials(me.user) && (
            <FormControlLabel
              control={<Switch checked={shareBudget} onChange={(e) => setShareBudget(e.target.checked)} />}
              label="Share budget status with the client in the gate pack"
            />
          )}
          {request.error && <Alert severity="error">{request.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!check.ok || request.isPending}>
          Request gate review
        </Button>
      </DialogActions>
    </Dialog>
  );
}
