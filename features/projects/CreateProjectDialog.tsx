'use client';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import { createProjectSchema } from '@/lib/schemas';
import { useCreateProject, useMe, useOrgs, usePeople } from '@/lib/client/api';
import { TEMPLATES } from '@/lib/domain/templates';

type Form = z.input<typeof createProjectSchema>;
const HEALTH = /clinic|health|hospital|medical|care/i;

export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: orgs = [] } = useOrgs();
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  const create = useCreateProject();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      key: '',
      clientOrgId: '',
      leadId: me?.user.id ?? '',
      startDate: today,
      targetDate: '',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 0,
      description: '',
      templateId: 'kdf-hybrid',
      restricted: false,
    },
  });
  const clientName = orgs.find((o) => o.id === watch('clientOrgId'))?.name ?? '';
  const leads = people.filter((p) => p.role === 'delivery_lead' || p.role === 'admin');

  const onSubmit = handleSubmit(async (v) => {
    const p = await create.mutateAsync(createProjectSchema.parse(v));
    onClose();
    router.push(`/projects/${p.key}`);
  });

  const field = (
    name: keyof Form,
    label: string,
    props: Record<string, unknown> = {},
    children?: React.ReactNode,
  ) => (
    <Controller
      name={name}
      control={control}
      render={({ field: f }) => (
        <TextField
          {...f}
          value={f.value ?? ''}
          label={label}
          fullWidth
          error={!!errors[name]}
          helperText={errors[name]?.message as string}
          {...props}
        >
          {children}
        </TextField>
      )}
    />
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <form onSubmit={onSubmit} noValidate>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          {create.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {create.error.message}
            </Alert>
          )}
          {HEALTH.test(clientName) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Do not store patient data in this workspace. Konnect Hub is not approved for PHI.
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 8 }}>{field('name', 'Project name', { autoFocus: true })}</Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              {field('key', 'Key (e.g. ACME)', {
                slotProps: { htmlInput: { style: { textTransform: 'uppercase' } } },
              })}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {field(
                'clientOrgId',
                'Client',
                { select: true },
                orgs
                  .filter((o) => o.type === 'client')
                  .map((o) => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.name}
                    </MenuItem>
                  )),
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {field(
                'leadId',
                'Delivery lead',
                { select: true },
                leads.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                )),
              )}
            </Grid>
            <Grid size={{ xs: 12 }}>
              {field(
                'templateId',
                'Template',
                { select: true },
                TEMPLATES.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                )),
              )}
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              {field('startDate', 'Start', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              {field('targetDate', 'Target', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              {field(
                'methodology',
                'Methodology',
                { select: true },
                ['hybrid', 'scrum', 'kanban', 'waterfall'].map((m) => (
                  <MenuItem key={m} value={m} sx={{ textTransform: 'capitalize' }}>
                    {m}
                  </MenuItem>
                )),
              )}
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              {field('contractType', 'Contract', { select: true }, [
                <MenuItem key="f" value="fixed_fee">
                  Fixed-fee milestones
                </MenuItem>,
                <MenuItem key="t" value="time_materials">
                  Time & Materials
                </MenuItem>,
                <MenuItem key="r" value="retainer">
                  Retainer
                </MenuItem>,
              ])}
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>{field('bac', 'Budget (BAC, USD)', { type: 'number' })}</Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <Controller
                name="restricted"
                control={control}
                render={({ field: f }) => (
                  <FormControlLabel
                    control={<Switch checked={!!f.value} onChange={(e) => f.onChange(e.target.checked)} />}
                    label="Restricted (U.S. persons only)"
                  />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              {field('description', 'Description', { multiline: true, minRows: 2 })}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={create.isPending}>
            Create project
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
