'use client';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
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
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import type { TemplateSummary } from '@/lib/domain/admin';
import { Mono } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useArchiveTemplate, useCreateTemplate, useTemplates } from './api';

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * /admin/templates (ADM-01): the built-in templates (read-only) and custom ones an Admin derives
 * from any template by editing gate exit criteria and RAID categories. Custom templates show up in
 * the create-project dialog; archiving one hides it there but keeps existing projects intact.
 */
export function TemplatesAdmin() {
  const { data: templates, isLoading, error } = useTemplates();
  const archive = useArchiveTemplate();
  const [base, setBase] = useState<TemplateSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <AdminPage
      title="Project templates"
      intro="Start a custom template from any existing one, then tailor its exit criteria and RAID categories."
    >
      <SavedNote text={note} />
      {(error || archive.error) && <Alert severity="error">{(error ?? archive.error)!.message}</Alert>}
      {isLoading ? (
        <Skeleton variant="rounded" height={200} />
      ) : (
        <Grid container spacing={2}>
          {(templates ?? []).map((t) => (
            <Grid key={t.id} size={{ xs: 12, md: 6, lg: 4 }}>
              <Card
                component="section"
                aria-labelledby={`tpl-${t.id}`}
                sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <CardContent sx={{ flex: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="h3" component="h2" id={`tpl-${t.id}`} sx={{ flex: 1 }}>
                      {t.name}
                    </Typography>
                    {t.builtin ? (
                      <Chip size="small" icon={<LockOutlined />} label="Built-in" />
                    ) : (
                      <Chip size="small" color="primary" variant="outlined" label="Custom" />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t.description}
                  </Typography>
                  <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                    {t.phases.map((p) => (
                      <li key={p.gate}>
                        <Typography variant="body2">
                          <strong>{p.name}</strong>: {p.criteria.join('; ')}
                        </Typography>
                      </li>
                    ))}
                  </Box>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                    {t.raidCategories.map((c) => (
                      <Chip key={c} size="small" label={c} variant="outlined" />
                    ))}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    <Mono>{t.id}</Mono>
                  </Typography>
                </CardContent>
                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Button
                    startIcon={<ContentCopyOutlined />}
                    onClick={() => setBase(t)}
                    aria-label={`Create a template from ${t.name}`}
                  >
                    Create from this
                  </Button>
                  {!t.builtin && (
                    <Button
                      color="warning"
                      disabled={archive.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Archive ${t.name}? Existing projects keep it; new projects can't use it.`,
                          )
                        )
                          archive.mutate(t.id, { onSuccess: () => setNote(`${t.name} archived.`) });
                      }}
                    >
                      Archive
                    </Button>
                  )}
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      {base && (
        <TemplateDialog
          base={base}
          onClose={(msg) => {
            setBase(null);
            if (msg) setNote(msg);
          }}
        />
      )}
    </AdminPage>
  );
}

function TemplateDialog({ base, onClose }: { base: TemplateSummary; onClose: (msg?: string) => void }) {
  const create = useCreateTemplate();
  const [name, setName] = useState(`${base.name} (custom)`);
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState(base.phases.map((p) => p.criteria.join('\n')));
  const [raid, setRaid] = useState(base.raidCategories.join('\n'));
  const save = () =>
    create.mutate(
      {
        baseId: base.id,
        name,
        description,
        phases: base.phases.map((p, i) => ({ gate: p.gate, criteria: lines(criteria[i]) })),
        raidCategories: lines(raid.replace(/,/g, '\n')),
      },
      { onSuccess: (t) => onClose(`${t.name} created. It's now in the create-project dialog.`) },
    );
  return (
    <Dialog open onClose={() => onClose()} aria-labelledby="tpl-dialog-title" fullWidth maxWidth="md">
      <DialogTitle id="tpl-dialog-title">New template from {base.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />
          <Typography variant="subtitle2">Exit criteria per gate (one per line)</Typography>
          <Grid container spacing={2}>
            {base.phases.map((p, i) => (
              <Grid key={p.gate} size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={`${p.gate}. ${p.name}`}
                  multiline
                  minRows={2}
                  fullWidth
                  value={criteria[i]}
                  onChange={(e) => setCriteria((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </Grid>
            ))}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="RAID categories (one per line)"
                multiline
                minRows={2}
                fullWidth
                value={raid}
                onChange={(e) => setRaid(e.target.value)}
              />
            </Grid>
          </Grid>
          {create.error && <Alert severity="error">{create.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={create.isPending}>
          Create template
        </Button>
      </DialogActions>
    </Dialog>
  );
}
