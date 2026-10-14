'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import { useMe } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { editableFields, loadLevel, type PersonField } from '@/lib/domain/capacity';
import type { PersonPatch } from '@/lib/capacity-schemas';
import { Mono } from '@/components/ui/bits';
import { usePerson, useUpdatePerson } from './api';
import { LoadChip } from './CapacityChips';

function TagInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={value}
      onChange={(_, v) => onChange(v as string[])}
      renderTags={(tags, getTagProps) =>
        tags.map((t, i) => {
          const { key, ...rest } = getTagProps({ index: i });
          return <Chip key={key} size="small" label={t} {...rest} />;
        })
      }
      renderInput={(params) => (
        <TextField {...params} size="small" label={label} helperText="Type and press Enter to add" />
      )}
    />
  );
}

export function ProfileDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: me } = useMe();
  const { data: p, isLoading, error } = usePerson(id);
  const save = useUpdatePerson(id ?? '');
  const fields = new Set<PersonField>(me ? editableFields(me.user) : []);
  const [form, setForm] = useState<PersonPatch>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!p) return;
    setForm({
      title: p.title ?? '',
      skills: p.skills,
      certifications: p.certifications ?? [],
      location: p.location ?? '',
      timezone: p.timezone ?? '',
      hoursPerWeek: p.hoursPerWeek,
      usPerson: p.usPerson,
      costRate: p.costRate,
    });
    setSaved(false);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id]);

  const submit = () => {
    const patch = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => fields.has(k as PersonField) && v !== undefined),
    ) as PersonPatch;
    save.mutate(patch, { onSuccess: () => setSaved(true) });
  };
  const set = <K extends keyof PersonPatch>(k: K, v: PersonPatch[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <Drawer
      anchor="right"
      open={Boolean(id)}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': 'profile-drawer-title',
          sx: { width: { xs: '100%', sm: 440 }, p: 2.5 },
        },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography id="profile-drawer-title" variant="h2" sx={{ flex: 1 }}>
          {p?.name ?? 'Profile'}
        </Typography>
        <IconButton onClick={onClose} aria-label="Close profile">
          <Close />
        </IconButton>
      </Stack>
      {error && <Alert severity="error">{error.message}</Alert>}
      {isLoading && <Skeleton variant="rounded" height={200} />}
      {p && (
        <Stack spacing={2}>
          <Box>
            {p.role && (
              <Typography color="text.secondary">
                {ROLE_LABEL[p.role]}
                {p.title ? ` · ${p.title}` : ''}
              </Typography>
            )}
            {p.email && <Typography variant="body2">{p.email}</Typography>}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
            {p.allocationPct !== undefined && (
              <>
                <Typography variant="body2">This week:</Typography>
                <LoadChip pct={p.allocationPct} level={loadLevel(p.allocationPct)} />
              </>
            )}
            {p.hoursPerWeek !== undefined && (
              <Typography variant="body2">
                <Mono>{p.hoursPerWeek}</Mono> h/week available
              </Typography>
            )}
          </Stack>
          {p.usPerson !== undefined && (
            <Typography variant="body2">U.S. person: {p.usPerson ? 'Yes' : 'No'}</Typography>
          )}
          {p.costRate !== undefined && (
            <Typography variant="body2">
              Cost rate: <Mono>${p.costRate}/h</Mono> (Admin only)
            </Typography>
          )}

          {p.memberships && (
            <Box>
              <Typography variant="h3" sx={{ mb: 0.5 }}>
                Projects
              </Typography>
              {p.memberships.length ? (
                <List dense disablePadding>
                  {p.memberships.map((m) => (
                    <ListItem key={m.projectId} disableGutters>
                      <ListItemText
                        primary={
                          <Link href={`/projects/${m.projectKey}/team`} style={{ color: 'inherit' }}>
                            <Mono>{m.projectKey}</Mono> {m.projectName}
                          </Link>
                        }
                        secondary={`${m.projectRole || 'Member'} · ${m.allocationPct}%`}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Not staffed on any project you can see.
                </Typography>
              )}
            </Box>
          )}

          <Divider />
          {fields.size === 0 ? (
            <Stack spacing={1}>
              <Typography variant="h3">Skills</Typography>
              <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                {p.skills.map((s) => (
                  <Chip key={s} size="small" label={s} />
                ))}
              </Stack>
              {p.certifications && (
                <>
                  <Typography variant="h3">Certifications</Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                    {p.certifications.map((s) => (
                      <Chip key={s} size="small" label={s} />
                    ))}
                  </Stack>
                </>
              )}
            </Stack>
          ) : (
            <Stack spacing={2} component="form" onSubmit={(e) => (e.preventDefault(), submit())}>
              <Typography variant="h3">Edit profile</Typography>
              {save.error && (
                <Alert severity="error" role="alert">
                  {save.error.message}
                </Alert>
              )}
              {saved && <Alert severity="success">Saved.</Alert>}
              {fields.has('title') && (
                <TextField
                  size="small"
                  label="Title"
                  value={form.title ?? ''}
                  onChange={(e) => set('title', e.target.value)}
                />
              )}
              <TagInput label="Skills" value={form.skills ?? []} onChange={(v) => set('skills', v)} />
              <TagInput
                label="Certifications"
                value={form.certifications ?? []}
                onChange={(v) => set('certifications', v)}
              />
              {fields.has('location') && (
                <TextField
                  size="small"
                  label="Location"
                  value={form.location ?? ''}
                  onChange={(e) => set('location', e.target.value)}
                />
              )}
              {fields.has('timezone') && (
                <TextField
                  size="small"
                  label="Time zone"
                  value={form.timezone ?? ''}
                  onChange={(e) => set('timezone', e.target.value)}
                />
              )}
              {fields.has('hoursPerWeek') && (
                <TextField
                  size="small"
                  type="number"
                  label="Availability (hours per week)"
                  value={form.hoursPerWeek ?? ''}
                  onChange={(e) =>
                    set('hoursPerWeek', e.target.value === '' ? undefined : Number(e.target.value))
                  }
                  slotProps={{ htmlInput: { min: 0, max: 80 } }}
                />
              )}
              {fields.has('costRate') && (
                <TextField
                  size="small"
                  type="number"
                  label="Cost rate ($/hour, Admin only)"
                  value={form.costRate ?? ''}
                  onChange={(e) =>
                    set('costRate', e.target.value === '' ? undefined : Number(e.target.value))
                  }
                  slotProps={{ htmlInput: { min: 0 } }}
                />
              )}
              {fields.has('usPerson') && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(form.usPerson)}
                      onChange={(e) => set('usPerson', e.target.checked)}
                    />
                  }
                  label="U.S. person (required for restricted projects)"
                />
              )}
              <Box>
                <Button type="submit" variant="contained" disabled={save.isPending}>
                  Save profile
                </Button>
              </Box>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
