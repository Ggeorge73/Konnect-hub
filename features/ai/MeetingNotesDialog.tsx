'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import NoteAltOutlined from '@mui/icons-material/NoteAltOutlined';
import { useMe } from '@/lib/client/api';
import { canEditItems } from '@/lib/domain/permissions';
import type { MeetingNotesResult, ProposedItem } from '@/lib/ai/views';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useAiStatus, useCreateFromNotes, useMeetingNotes } from './api';
import { AiDraftChip, aiOffReason } from './AiBits';

const TYPES: { id: ProposedItem['type']; label: string }[] = [
  { id: 'task', label: 'Task' },
  { id: 'story', label: 'Story' },
  { id: 'bug', label: 'Bug' },
  { id: 'feature', label: 'Feature' },
  { id: 'change_request', label: 'Change request' },
];
const PRIORITIES: { id: ProposedItem['priority']; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

type Row = ProposedItem & { pick: boolean };

/**
 * "Paste meeting notes" on the board and list (KH-44). Claude proposes items; the user edits the
 * preview table and ticks the rows to create. Created items are internal backlog items.
 */
export function MeetingNotesButton() {
  const { project } = useProjectBundle();
  const { data: me } = useMe();
  const { data: st } = useAiStatus(project.key);
  const [open, setOpen] = useState(false);
  if (!me || !canEditItems(me.user) || !st) return null;
  const reason = aiOffReason(st, 'meeting_notes');
  return (
    <>
      <Tooltip title={reason ?? 'Turn meeting notes into proposed work items'}>
        <span>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            startIcon={<NoteAltOutlined />}
            onClick={() => setOpen(true)}
            disabled={Boolean(reason)}
          >
            Paste meeting notes
          </Button>
        </span>
      </Tooltip>
      {open && <MeetingNotesDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function MeetingNotesDialog({ onClose }: { onClose: () => void }) {
  const { project } = useProjectBundle();
  const extract = useMeetingNotes(project.key);
  const create = useCreateFromNotes(project.key, project.id);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<MeetingNotesResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [created, setCreated] = useState<string[] | null>(null);
  const picked = rows.filter((r) => r.pick);
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const run = () =>
    extract.mutate(notes, {
      onSuccess: (r) => {
        setPreview(r);
        setRows(r.items.map((i) => ({ ...i, pick: true })));
      },
    });
  const save = () =>
    create.mutate(
      picked.map(({ pick: _pick, ...item }) => item),
      { onSuccess: (items) => setCreated(items.map((i) => i.key)) },
    );

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="notes-title">
      <DialogTitle id="notes-title">
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
          <span>Meeting notes to work items</span>
          {preview && <AiDraftChip />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {created ? (
          <Alert severity="success" data-testid="notes-created">
            Created {created.length} internal backlog item{created.length === 1 ? '' : 's'}:{' '}
            {created.join(', ')}.
          </Alert>
        ) : !preview ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Paste the notes from a meeting. Claude proposes work items from the action points; you choose
              which to create. Assignees are only ever suggested from this project’s team.
            </Typography>
            <TextField
              label="Meeting notes"
              multiline
              minRows={8}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={'- Lara to confirm the cutover date by Friday\n- Fix the duplicate MRN bug'}
              fullWidth
              autoFocus
            />
          </Stack>
        ) : rows.length === 0 ? (
          <Typography color="text.secondary">
            No action items found in these notes. Edit the notes and try again.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Proposed work items">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">Create</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell sx={{ minWidth: 260 }}>Title</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Due</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i} data-testid="proposed-item">
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={r.pick}
                        onChange={(e) => set(i, { pick: e.target.checked })}
                        slotProps={{ input: { 'aria-label': `Create item ${i + 1}: ${r.title}` } }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={r.type}
                        onChange={(e) => set(i, { type: e.target.value as ProposedItem['type'] })}
                        slotProps={{ htmlInput: { 'aria-label': `Type of item ${i + 1}` } }}
                      >
                        {TYPES.map((t) => (
                          <MenuItem key={t.id} value={t.id}>
                            {t.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={r.title}
                        onChange={(e) => set(i, { title: e.target.value })}
                        slotProps={{ htmlInput: { 'aria-label': `Title of item ${i + 1}` } }}
                        helperText={r.description}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={r.assigneeId ?? ''}
                        onChange={(e) => set(i, { assigneeId: e.target.value || null })}
                        slotProps={{ htmlInput: { 'aria-label': `Assignee of item ${i + 1}` } }}
                        sx={{ minWidth: 150 }}
                      >
                        <MenuItem value="">Unassigned</MenuItem>
                        {preview.members.map((m) => (
                          <MenuItem key={m.id} value={m.id}>
                            {m.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={r.priority}
                        onChange={(e) => set(i, { priority: e.target.value as ProposedItem['priority'] })}
                        slotProps={{ htmlInput: { 'aria-label': `Priority of item ${i + 1}` } }}
                      >
                        {PRIORITIES.map((p) => (
                          <MenuItem key={p.id} value={p.id}>
                            {p.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="date"
                        value={r.dueDate ?? ''}
                        onChange={(e) => set(i, { dueDate: e.target.value || null })}
                        slotProps={{ htmlInput: { 'aria-label': `Due date of item ${i + 1}` } }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {(extract.error || create.error) && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(extract.error ?? create.error)!.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{created ? 'Done' : 'Cancel'}</Button>
        {!created && !preview && (
          <Button variant="contained" onClick={run} disabled={!notes.trim() || extract.isPending}>
            {extract.isPending ? 'Reading notes…' : 'Propose items'}
          </Button>
        )}
        {!created && preview && (
          <>
            <Button onClick={() => setPreview(null)}>Back to notes</Button>
            <Button
              variant="contained"
              onClick={save}
              disabled={!picked.length || picked.some((r) => !r.title.trim()) || create.isPending}
            >
              Create {picked.length} item{picked.length === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
