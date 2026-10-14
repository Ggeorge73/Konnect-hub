'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import { FIELD_KINDS, FIELD_KIND_LABEL, type CustomField, type CustomFieldKind } from '@/lib/domain/admin';
import type { Visibility } from '@/lib/domain/types';
import { EmptyState, VisibilityChip } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useCreateField, useCustomFields, useUpdateField } from './api';

const lines = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * /admin/fields (ADM-01): workspace custom fields (text, number, date, select). They appear in
 * every item side panel and as optional columns in the list view. Shared fields show their values
 * in the client portal on shared items; internal ones never leave Konnector. Archive, never delete.
 */
export function FieldsAdmin() {
  const { data: fields, isLoading, error } = useCustomFields({ archived: true });
  const update = useUpdateField();
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <AdminPage
      title="Custom fields"
      intro="Fields every work item can carry. Internal fields stay with Konnector; shared ones show in the portal."
      action={
        <Button variant="contained" startIcon={<Add />} onClick={() => setEditing('new')}>
          Add field
        </Button>
      }
    >
      <SavedNote text={note} />
      {(error || update.error) && <Alert severity="error">{(error ?? update.error)!.message}</Alert>}
      <Paper sx={{ borderRadius: 4 }}>
        {isLoading ? (
          <Skeleton variant="rounded" height={160} sx={{ m: 2 }} />
        ) : !fields?.length ? (
          <EmptyState
            title="No custom fields yet"
            body="Add a field such as Site, Contract line or Go-live date."
            action={
              <Button variant="contained" onClick={() => setEditing('new')}>
                Add field
              </Button>
            }
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Custom fields">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Options</TableCell>
                  <TableCell>Visibility</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.id} hover data-testid={`cf-${f.name}`}>
                    <TableCell>{f.name}</TableCell>
                    <TableCell>{FIELD_KIND_LABEL[f.kind]}</TableCell>
                    <TableCell>{f.options.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <VisibilityChip visibility={f.visibility} showShared />
                    </TableCell>
                    <TableCell>{f.archivedAt ? <Chip size="small" label="Archived" /> : 'Active'}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button size="small" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          color={f.archivedAt ? 'primary' : 'warning'}
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate(
                              { id: f.id, patch: { archived: !f.archivedAt } },
                              {
                                onSuccess: () =>
                                  setNote(`${f.name} ${f.archivedAt ? 'restored' : 'archived'}.`),
                              },
                            )
                          }
                          aria-label={`${f.archivedAt ? 'Restore' : 'Archive'} ${f.name}`}
                        >
                          {f.archivedAt ? 'Restore' : 'Archive'}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
      {editing && (
        <FieldDialog
          field={editing === 'new' ? null : editing}
          onClose={(msg) => {
            setEditing(null);
            if (msg) setNote(msg);
          }}
        />
      )}
    </AdminPage>
  );
}

function FieldDialog({ field, onClose }: { field: CustomField | null; onClose: (msg?: string) => void }) {
  const create = useCreateField();
  const update = useUpdateField();
  const [name, setName] = useState(field?.name ?? '');
  const [kind, setKind] = useState<CustomFieldKind>(field?.kind ?? 'text');
  const [options, setOptions] = useState(field?.options.join('\n') ?? '');
  const [visibility, setVisibility] = useState<Visibility>(field?.visibility ?? 'internal');
  const err = create.error ?? update.error;
  const save = async () => {
    if (field)
      await update.mutateAsync({
        id: field.id,
        patch: { name, visibility, ...(field.kind === 'select' ? { options: lines(options) } : {}) },
      });
    else await create.mutateAsync({ name, kind, options: lines(options), visibility });
    onClose(`${name} saved.`);
  };
  return (
    <Dialog open onClose={() => onClose()} aria-labelledby="cf-dialog-title" fullWidth maxWidth="xs">
      <DialogTitle id="cf-dialog-title">{field ? `Edit ${field.name}` : 'Add a custom field'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Field name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            fullWidth
          />
          <TextField
            select
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as CustomFieldKind)}
            disabled={Boolean(field)}
            helperText={field ? 'The type cannot change once the field exists.' : undefined}
            fullWidth
          >
            {FIELD_KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {FIELD_KIND_LABEL[k]}
              </MenuItem>
            ))}
          </TextField>
          {kind === 'select' && (
            <TextField
              label="Options (one per line)"
              multiline
              minRows={3}
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              fullWidth
            />
          )}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={visibility}
            onChange={(_, v) => v && setVisibility(v)}
            aria-label="Field visibility"
          >
            <ToggleButton value="internal">
              <LockOutlined sx={{ fontSize: 16, mr: 0.5 }} aria-hidden />
              Internal
            </ToggleButton>
            <ToggleButton value="shared">
              <PublicOutlined sx={{ fontSize: 16, mr: 0.5 }} aria-hidden />
              Shared with clients
            </ToggleButton>
          </ToggleButtonGroup>
          {err && <Alert severity="error">{err.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save().catch(() => {})}
          disabled={create.isPending || update.isPending || name.trim().length < 2}
        >
          {field ? 'Save' : 'Add field'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
