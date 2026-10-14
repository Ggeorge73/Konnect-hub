'use client';
import { useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import Add from '@mui/icons-material/Add';
import UploadOutlined from '@mui/icons-material/UploadOutlined';
import type { AdminOrg } from '@/lib/domain/admin';
import { LOGO_TYPES, MAX_LOGO_BYTES, uploadError } from '@/lib/domain/files';
import { EmptyState, Mono, initials } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useAdminOrgs, useCreateOrg, useUpdateOrg, useUploadLogo } from './api';

/** /admin/clients (ADM-01): add, rename and brand client organizations (logo upload). Audited. */
export function ClientsAdmin() {
  const { data: orgs, isLoading, error } = useAdminOrgs();
  const [editing, setEditing] = useState<AdminOrg | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <AdminPage
      title="Client organizations"
      intro="Each client gets its own portal, a private file bucket and its logo in the portal header."
      action={
        <Button variant="contained" startIcon={<Add />} onClick={() => setEditing('new')}>
          Add client
        </Button>
      }
    >
      <SavedNote text={note} />
      {error ? (
        <Alert severity="error">{error.message}</Alert>
      ) : isLoading ? (
        <Skeleton variant="rounded" height={160} />
      ) : !orgs?.length ? (
        <Card>
          <EmptyState
            title="No clients yet"
            body="Add your first client organization, then create a project for it."
            action={
              <Button variant="contained" onClick={() => setEditing('new')}>
                Add client
              </Button>
            }
          />
        </Card>
      ) : (
        <Grid container spacing={2}>
          {orgs.map((o) => (
            <Grid key={o.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card component="section" aria-label={o.name} sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Avatar
                      variant="rounded"
                      src={o.logoUrl}
                      alt={o.logoUrl ? `${o.name} logo` : undefined}
                      sx={{ width: 48, height: 48, bgcolor: 'background.paper', color: 'primary.main' }}
                    >
                      {initials(o.name)}
                    </Avatar>
                    <div>
                      <Typography variant="h3" component="h2">
                        {o.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        <Mono>{o.userCount}</Mono> users · <Mono>{o.projectCount}</Mono> projects
                      </Typography>
                    </div>
                  </Stack>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Button onClick={() => setEditing(o)} aria-label={`Edit ${o.name}`}>
                    Edit
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {editing && (
        <OrgDialog
          org={editing === 'new' ? null : editing}
          onClose={(msg) => {
            setEditing(null);
            if (msg) setNote(msg);
          }}
        />
      )}
    </AdminPage>
  );
}

function OrgDialog({ org, onClose }: { org: AdminOrg | null; onClose: (msg?: string) => void }) {
  const create = useCreateOrg();
  const update = useUpdateOrg();
  const upload = useUploadLogo();
  const [name, setName] = useState(org?.name ?? '');
  const [logoUrl, setLogoUrl] = useState(org?.logoUrl ?? '');
  const [fileError, setFileError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const err = create.error ?? update.error ?? upload.error;
  const busy = create.isPending || update.isPending || upload.isPending;

  const save = async () => {
    if (org) {
      await update.mutateAsync({ id: org.id, name, logoUrl });
      onClose(`${name} saved.`);
    } else {
      await create.mutateAsync({ name, logoUrl: '' });
      onClose(`${name} added. Upload a logo from Edit.`);
    }
  };

  return (
    <Dialog open onClose={() => onClose()} aria-labelledby="org-dialog-title" fullWidth maxWidth="xs">
      <DialogTitle id="org-dialog-title">{org ? `Edit ${org.name}` : 'Add a client'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Client name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            fullWidth
          />
          {org && (
            <Stack direction="row" spacing={2} alignItems="center">
              <Avatar
                variant="rounded"
                src={logoUrl || undefined}
                alt={logoUrl ? `${name} logo` : undefined}
                sx={{ width: 56, height: 56 }}
              >
                {initials(name || '?')}
              </Avatar>
              <input
                ref={input}
                type="file"
                hidden
                accept={LOGO_TYPES.join(',')}
                aria-label="Logo file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const bad = uploadError(
                    { name: f.name, size: f.size, type: f.type },
                    { maxBytes: MAX_LOGO_BYTES, types: LOGO_TYPES },
                  );
                  setFileError(bad);
                  if (!bad)
                    upload.mutate({ id: org.id, file: f }, { onSuccess: (o) => setLogoUrl(o.logoUrl ?? '') });
                }}
              />
              <Stack spacing={0.5}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<UploadOutlined />}
                  onClick={() => input.current?.click()}
                  disabled={busy}
                >
                  {upload.isPending ? 'Uploading…' : 'Upload logo'}
                </Button>
                {logoUrl && (
                  <Button size="small" onClick={() => setLogoUrl('')} disabled={busy}>
                    Remove logo
                  </Button>
                )}
                <Typography variant="caption" color="text.secondary">
                  PNG, JPG, GIF or WebP, up to 2 MB.
                </Typography>
              </Stack>
            </Stack>
          )}
          {fileError && <Alert severity="error">{fileError}</Alert>}
          {err && <Alert severity="error">{err.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => save().catch(() => {})}
          disabled={busy || name.trim().length < 2}
        >
          {org ? 'Save' : 'Add client'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
