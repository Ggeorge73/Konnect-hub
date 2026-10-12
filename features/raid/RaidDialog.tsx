'use client';
import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import {
  closureError,
  RAID_KINDS,
  RAID_STATUS_LABEL,
  RISK_CATEGORIES,
  riskScore,
  ROAM,
  SEVERITIES,
  SLA_RULE,
  shouldEscalate,
  type IssueSeverity,
  type RaidKind,
  type RaidStatus,
  type RaidView,
  type RiskCategory,
  type Roam,
} from '@/lib/domain/raid';
import type { Profile, Visibility, WorkItem } from '@/lib/domain/types';
import { isClientRole } from '@/lib/domain/permissions';
import { EscalateChip, ScoreChip } from './RaidChips';
import { useSaveRaid } from './api';

type Level = number | '';

interface Form {
  title: string;
  description: string;
  ownerId: string;
  status: RaidStatus;
  visibility: Visibility;
  category: RiskCategory | '';
  probability: Level;
  impact: Level;
  residualProbability: Level;
  residualImpact: Level;
  mitigation: string;
  roam: Roam | '';
  closureNote: string;
  severity: IssueSeverity | '';
  date: string;
  decidedBy: string;
  rationale: string;
  linkedItemIds: string[];
}

function initial(kind: RaidKind, e?: RaidView): Form {
  return {
    title: e?.title ?? '',
    description: e?.description ?? '',
    ownerId: e?.ownerId ?? '',
    status: e?.status ?? (kind === 'decision' ? 'closed' : 'open'),
    visibility: e?.visibility ?? 'internal',
    category: e?.category ?? '',
    probability: e?.probability ?? '',
    impact: e?.impact ?? '',
    residualProbability: e?.residualProbability ?? '',
    residualImpact: e?.residualImpact ?? '',
    mitigation: e?.mitigation ?? '',
    roam: e?.roam ?? '',
    closureNote: e?.closureNote ?? '',
    severity: e?.severity ?? '',
    date: e?.date ?? '',
    decidedBy: e?.decidedBy ?? '',
    rationale: e?.rationale ?? '',
    linkedItemIds: e?.linkedItemIds ?? [],
  };
}

const num = (v: Level) => (v === '' ? null : v);
const str = (v: string) => (v.trim() ? v : null);

export function RaidDialog({
  open,
  kind,
  entry,
  projectId,
  projectKey,
  people,
  items,
  onClose,
}: {
  open: boolean;
  kind: RaidKind;
  entry?: RaidView;
  projectId: string;
  projectKey: string;
  people: Profile[];
  items: WorkItem[];
  onClose: () => void;
}) {
  const meta = RAID_KINDS.find((k) => k.id === kind)!;
  const [f, setF] = useState<Form>(() => initial(kind, entry));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRaid(projectKey);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const isRisk = kind === 'risk';
  const internal = people.filter((p) => !isClientRole(p.role));
  const score = riskScore(num(f.probability), num(f.impact));
  const residual = riskScore(num(f.residualProbability), num(f.residualImpact));
  const statuses: RaidStatus[] = isRisk ? ['open', 'closed'] : ['open', 'in_progress', 'closed'];
  const noteError = closureError(kind, f.status, f.closureNote);

  const submit = async () => {
    setError(null);
    if (!f.title.trim()) return setError('Title is required.');
    if (noteError) return setError(noteError);
    const body = {
      title: f.title,
      description: f.description,
      ownerId: f.ownerId || null,
      status: f.status,
      visibility: f.visibility,
      closureNote: str(f.closureNote),
      linkedItemIds: f.linkedItemIds,
      ...(isRisk && {
        category: f.category || null,
        probability: num(f.probability),
        impact: num(f.impact),
        residualProbability: num(f.residualProbability),
        residualImpact: num(f.residualImpact),
        mitigation: str(f.mitigation),
        roam: f.roam || null,
      }),
      ...(kind === 'issue' && { severity: f.severity || null }),
      ...(kind !== 'risk' && kind !== 'issue' && { date: f.date || null }),
      ...(kind === 'decision' && { decidedBy: f.decidedBy || null, rationale: str(f.rationale) }),
    };
    try {
      await save.mutateAsync(
        entry ? { id: entry.id, patch: body } : { create: { ...body, projectId, kind } },
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const levelSelect = (
    label: string,
    k: 'probability' | 'impact' | 'residualProbability' | 'residualImpact',
    optional = false,
  ) => (
    <TextField
      select
      size="small"
      label={label}
      value={f[k]}
      onChange={(e) => set(k, e.target.value === '' ? '' : Number(e.target.value))}
      required={!optional}
    >
      {optional && <MenuItem value="">Not set</MenuItem>}
      {[1, 2, 3, 4, 5].map((n) => (
        <MenuItem key={n} value={n}>
          {n}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="raid-dialog-title">
      <DialogTitle id="raid-dialog-title">
        {entry ? `Edit ${meta.label.toLowerCase()}` : `Add ${meta.label.toLowerCase()}`}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {error}
          </Alert>
        )}
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            autoFocus
            size="small"
            label="Title"
            required
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <TextField
            size="small"
            label="Description"
            multiline
            minRows={2}
            value={f.description}
            onChange={(e) => set('description', e.target.value)}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}>
            {isRisk && (
              <TextField
                select
                size="small"
                label="Category"
                required
                value={f.category}
                onChange={(e) => set('category', e.target.value as RiskCategory)}
              >
                {RISK_CATEGORIES.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {kind === 'issue' && (
              <TextField
                select
                size="small"
                label="Severity"
                required
                value={f.severity}
                onChange={(e) => set('severity', e.target.value as IssueSeverity)}
                helperText={f.severity ? `SLA: ${SLA_RULE[f.severity].label} from creation` : ' '}
              >
                {SEVERITIES.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.label} · {SLA_RULE[s.id].label}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              size="small"
              label="Owner"
              value={f.ownerId}
              onChange={(e) => set('ownerId', e.target.value)}
            >
              <MenuItem value="">Unassigned</MenuItem>
              {internal.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={f.status}
              onChange={(e) => set('status', e.target.value as RaidStatus)}
            >
              {statuses.map((s) => (
                <MenuItem key={s} value={s}>
                  {RAID_STATUS_LABEL[s]}
                </MenuItem>
              ))}
            </TextField>
            {kind !== 'risk' && kind !== 'issue' && (
              <TextField
                size="small"
                type="date"
                label={
                  kind === 'decision' ? 'Decided on' : kind === 'dependency' ? 'Needed by' : 'Validate by'
                }
                value={f.date}
                onChange={(e) => set('date', e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
            {kind === 'decision' && (
              <TextField
                select
                size="small"
                label="Decided by"
                value={f.decidedBy}
                onChange={(e) => set('decidedBy', e.target.value)}
              >
                <MenuItem value="">Not recorded</MenuItem>
                {people.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>

          {isRisk && (
            <>
              <Box
                sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr' }, gap: 1.5 }}
              >
                {levelSelect('Probability (1–5)', 'probability')}
                {levelSelect('Impact (1–5)', 'impact')}
                <Stack direction="row" spacing={1} alignItems="center" aria-live="polite">
                  <Typography variant="body2" color="text.secondary">
                    Score
                  </Typography>
                  <ScoreChip score={score} />
                  {shouldEscalate(num(f.probability), num(f.impact)) && <EscalateChip />}
                </Stack>
              </Box>
              <TextField
                size="small"
                label="Mitigation plan"
                multiline
                minRows={2}
                value={f.mitigation}
                onChange={(e) => set('mitigation', e.target.value)}
              />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' },
                  gap: 1.5,
                }}
              >
                {levelSelect('Residual probability', 'residualProbability', true)}
                {levelSelect('Residual impact', 'residualImpact', true)}
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    Residual
                  </Typography>
                  <ScoreChip score={residual} />
                </Stack>
                <TextField
                  select
                  size="small"
                  label="ROAM"
                  value={f.roam}
                  onChange={(e) => set('roam', e.target.value as Roam)}
                >
                  <MenuItem value="">Not set</MenuItem>
                  {ROAM.map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </>
          )}

          {kind === 'decision' && (
            <TextField
              size="small"
              label="Rationale"
              multiline
              minRows={2}
              value={f.rationale}
              onChange={(e) => set('rationale', e.target.value)}
            />
          )}

          {f.status === 'closed' && kind !== 'decision' && (
            <TextField
              size="small"
              label="Closure note"
              multiline
              minRows={2}
              required={isRisk}
              value={f.closureNote}
              onChange={(e) => set('closureNote', e.target.value)}
              error={Boolean(error && noteError)}
              helperText={
                isRisk
                  ? 'Required to close a risk: how was it resolved or why is it no longer relevant?'
                  : ' '
              }
            />
          )}

          <Autocomplete
            multiple
            size="small"
            options={items.map((i) => i.id)}
            value={f.linkedItemIds.filter((id) => items.some((i) => i.id === id))}
            onChange={(_, v) => set('linkedItemIds', v)}
            getOptionLabel={(id) => {
              const it = items.find((i) => i.id === id);
              return it ? `${it.key} ${it.title}` : id;
            }}
            renderInput={(p) => <TextField {...p} label="Linked work items" placeholder="Search items" />}
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Visibility
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={f.visibility}
              onChange={(_, v: Visibility | null) => v && set('visibility', v)}
              aria-label="Visibility"
            >
              <ToggleButton value="internal">
                <LockOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                Internal
              </ToggleButton>
              <ToggleButton value="shared">
                <PublicOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                Shared with client
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>
          {entry ? 'Save' : `Add ${meta.label.toLowerCase()}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
