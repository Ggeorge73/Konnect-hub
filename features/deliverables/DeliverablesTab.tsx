'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
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
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import Add from '@mui/icons-material/Add';
import SendOutlined from '@mui/icons-material/SendOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { api, useItems, useMe, usePeople } from '@/lib/client/api';
import type { DeliverableView } from '@/lib/data/deliverables';
import { canEditDeliverables } from '@/lib/domain/deliverables';
import { isClientRole } from '@/lib/domain/permissions';
import type { Visibility } from '@/lib/domain/types';
import { EmptyState } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useDeliverables, useGateInvalidate } from '@/features/gates/api';
import { DeliverableCard } from './DeliverableCard';

/** DLV-01: deliverables bundle work items with acceptance criteria for client sign-off. */
export function DeliverablesTab() {
  const b = useProjectBundle();
  const path = usePathname();
  const { data, error, isLoading } = useDeliverables(b.project.key);
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  const invalidate = useGateInvalidate(b.project.key);
  const [editing, setEditing] = useState<DeliverableView | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const editor = me ? canEditDeliverables(me.user) : false;
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data) return <Skeleton variant="rounded" height={320} />;
  const submit = async (id: string) => {
    setActionError(null);
    try {
      await api(`/api/deliverables/${id}/submit`, { method: 'POST' });
      await invalidate();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h2">Deliverables</Typography>
          <Typography variant="body2" color="text.secondary">
            Bundles of work the client accepts criterion by criterion.
          </Typography>
        </Box>
        {editor && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setEditing('new')}>
            New deliverable
          </Button>
        )}
      </Stack>
      {actionError && <Alert severity="error">{actionError}</Alert>}
      {data.length === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="No deliverables yet"
            body="Group finished work into a deliverable with acceptance criteria so the client can sign it off."
            action={
              editor ? (
                <Button variant="contained" onClick={() => setEditing('new')}>
                  Create the first deliverable
                </Button>
              ) : undefined
            }
          />
        </Paper>
      ) : (
        data.map((d) => (
          <DeliverableCard
            key={d.id}
            d={d}
            people={people}
            phaseName={b.phases.find((p) => p.id === d.phaseId)?.name}
            itemHref={(k) => `${path}?item=${k}`}
            canDecide={false}
            onChanged={invalidate}
            actions={
              editor && (d.status === 'draft' || d.status === 'rejected') ? (
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<EditOutlined />} onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SendOutlined />}
                    onClick={() => submit(d.id)}
                  >
                    {d.status === 'rejected' ? 'Resubmit for acceptance' : 'Submit for acceptance'}
                  </Button>
                </Stack>
              ) : undefined
            }
          />
        ))
      )}
      <DeliverableDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        open={Boolean(editing)}
        initial={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function DeliverableDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: DeliverableView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const b = useProjectBundle();
  const { data: items = [] } = useItems(b.project.id);
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  const current = b.phases.find((p) => !['approved', 'approved_with_conditions'].includes(p.status));
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [phaseId, setPhaseId] = useState(initial?.phaseId ?? current?.id ?? '');
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'shared');
  const [itemIds, setItemIds] = useState<string[]>(initial?.itemIds ?? []);
  const [criteria, setCriteria] = useState(initial?.criteria.map((c) => c.text).join('\n') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ownerId && me) setOwnerId(me.user.id);
  }, [me, ownerId]);
  const staff = people.filter((p) => !isClientRole(p.role));
  const linkable = items.filter((i) => i.type !== 'epic');
  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name,
      description,
      phaseId: phaseId || null,
      ownerId,
      dueDate: dueDate || null,
      visibility,
      itemIds,
      criteria: criteria.split('\n'),
    };
    try {
      await api(initial ? `/api/deliverables/${initial.id}` : `/api/projects/${b.project.key}/deliverables`, {
        method: initial ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{initial ? 'Edit deliverable' : 'New deliverable'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ pt: 1 }}>
          <Grid size={12}>
            <TextField
              label="Deliverable name"
              required
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Owner"
              fullWidth
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              {staff.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              type="date"
              label="Due date"
              fullWidth
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Phase"
              fullWidth
              value={phaseId}
              onChange={(e) => setPhaseId(e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              {b.phases.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.gate} · {p.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              select
              label="Visibility"
              fullWidth
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              helperText="Only shared deliverables can be sent to the client."
            >
              <MenuItem value="shared">Shared with client</MenuItem>
              <MenuItem value="internal">Internal</MenuItem>
            </TextField>
          </Grid>
          <Grid size={12}>
            <Autocomplete
              multiple
              options={linkable}
              value={linkable.filter((i) => itemIds.includes(i.id))}
              onChange={(_, v) => setItemIds(v.map((i) => i.id))}
              getOptionLabel={(i) => `${i.key} ${i.title}`}
              isOptionEqualToValue={(a, v) => a.id === v.id}
              renderInput={(p) => <TextField {...p} label="Linked work items" placeholder="Search items" />}
            />
          </Grid>
          <Grid size={12}>
            <TextField
              label="Acceptance criteria"
              fullWidth
              multiline
              minRows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              helperText="One criterion per line. The client accepts or rejects each one."
            />
          </Grid>
        </Grid>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || !name.trim()}>
          {initial ? 'Save deliverable' : 'Create deliverable'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
