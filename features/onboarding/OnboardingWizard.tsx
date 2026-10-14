'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import UploadOutlined from '@mui/icons-material/UploadOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { api, qk } from '@/lib/client/api';
import { APP_NAME } from '@/lib/config';
import type { Invite, WorkspaceSettings } from '@/lib/domain/onboarding';
import {
  clientOrgSchema,
  inviteSchema,
  INVITE_ROLES,
  logoUrlSchema,
  ONBOARDING_SEEN_COOKIE,
  ONBOARDING_STEPS,
  workspaceSchema,
} from '@/lib/domain/onboarding';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { createProjectSchema } from '@/lib/schemas';
import { TEMPLATES } from '@/lib/domain/templates';
import type { Organization, Project } from '@/lib/domain/types';

type Client = Pick<Organization, 'id' | 'name'>;

/** Reads an image file as a data URI (kept small: logos only). */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file.'));
    if (file.size > 140_000) return reject(new Error('Logo must be under 140 KB.'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

function LogoField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label: string;
}) {
  const [readError, setReadError] = useState<string | null>(null);
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {value ? (
          <Box
            component="img"
            src={value}
            alt={`${label} preview`}
            sx={{ width: 48, height: 48, objectFit: 'contain' }}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            No logo
          </Typography>
        )}
      </Box>
      <Button component="label" variant="outlined" startIcon={<UploadOutlined />}>
        Upload {label.toLowerCase()}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setReadError(null);
              onChange(await readImage(f));
            } catch (err) {
              setReadError((err as Error).message);
            }
          }}
        />
      </Button>
      {value && (
        <Button color="inherit" onClick={() => onChange('')}>
          Remove
        </Button>
      )}
      {(readError || error) && (
        <Typography variant="body2" color="error" role="alert" sx={{ width: '100%' }}>
          {readError ?? error}
        </Typography>
      )}
    </Stack>
  );
}

function StepActions({
  onBack,
  busy,
  submitLabel,
  extra,
}: {
  onBack?: () => void;
  busy: boolean;
  submitLabel: string;
  extra?: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 3, flexWrap: 'wrap' }} useFlexGap>
      {onBack && (
        <Button onClick={onBack} disabled={busy} sx={{ mr: 'auto' }}>
          Back
        </Button>
      )}
      {extra}
      <Button type="submit" variant="contained" disabled={busy}>
        {submitLabel}
      </Button>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Step 1: workspace name and logo
// ---------------------------------------------------------------------------
function WorkspaceStep({ workspace, onDone }: { workspace: WorkspaceSettings; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof workspaceSchema>>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: { name: workspace.name || '', logoUrl: workspace.logoUrl ?? '' },
  });
  const submit = handleSubmit(async (v) => {
    try {
      await api('/api/onboarding/workspace', { method: 'PUT', body: JSON.stringify(v) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <form onSubmit={submit} noValidate aria-labelledby="step-title">
      <Typography variant="h2" id="step-title" gutterBottom>
        Name your workspace
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        This is what your team and your clients see in the header. Leave the logo empty to use the {APP_NAME}{' '}
        mark.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2.5}>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Workspace name"
              required
              autoFocus
              error={!!errors.name}
              helperText={
                errors.name?.message ?? `For example “Konnector Delivery”. Defaults to ${APP_NAME}.`
              }
            />
          )}
        />
        <Controller
          name="logoUrl"
          control={control}
          render={({ field }) => (
            <LogoField
              label="Workspace logo"
              value={field.value ?? ''}
              onChange={field.onChange}
              error={errors.logoUrl?.message}
            />
          )}
        />
      </Stack>
      <StepActions busy={isSubmitting} submitLabel="Save and continue" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2: first client org
// ---------------------------------------------------------------------------
const clientStepSchema = z
  .object({
    choice: z.enum(['new', 'existing']),
    name: z.string(),
    logoUrl: logoUrlSchema.default(''),
    existingId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.choice === 'existing' && !v.existingId)
      ctx.addIssue({ code: 'custom', path: ['existingId'], message: 'Choose a client' });
    if (v.choice === 'new') {
      const r = clientOrgSchema.safeParse({ name: v.name, logoUrl: v.logoUrl });
      if (!r.success)
        for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: i.path, message: i.message });
    }
  });

function ClientStep({
  clients,
  onBack,
  onDone,
}: {
  clients: Client[];
  onBack: () => void;
  onDone: (c: Client) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof clientStepSchema>>({
    resolver: zodResolver(clientStepSchema),
    defaultValues: { choice: 'new', name: '', logoUrl: '', existingId: '' },
  });
  const choice = watch('choice');
  const submit = handleSubmit(async (v) => {
    try {
      if (v.choice === 'existing') return onDone(clients.find((c) => c.id === v.existingId)!);
      const org = await api<Organization>('/api/onboarding/clients', {
        method: 'POST',
        body: JSON.stringify({ name: v.name, logoUrl: v.logoUrl }),
      });
      onDone(org);
    } catch (e) {
      setError((e as Error).message);
    }
  });
  return (
    <form onSubmit={submit} noValidate aria-labelledby="step-title">
      <Typography variant="h2" id="step-title" gutterBottom>
        Add your first client
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Each client gets its own portal, isolated from every other client. Their logo appears next to yours.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2.5}>
        {clients.length > 0 && (
          <Controller
            name="choice"
            control={control}
            render={({ field }) => (
              <RadioGroup row {...field} aria-label="Client">
                <FormControlLabel value="new" control={<Radio />} label="Create a new client" />
                <FormControlLabel value="existing" control={<Radio />} label="Use an existing client" />
              </RadioGroup>
            )}
          />
        )}
        {choice === 'new' ? (
          <>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Client name"
                  required
                  autoFocus
                  error={!!errors.name}
                  helperText={errors.name?.message ?? 'The organization you deliver for, e.g. “Acme Health”.'}
                />
              )}
            />
            <Controller
              name="logoUrl"
              control={control}
              render={({ field }) => (
                <LogoField
                  label="Client logo"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  error={errors.logoUrl?.message}
                />
              )}
            />
          </>
        ) : (
          <Controller
            name="existingId"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Existing client"
                error={!!errors.existingId}
                helperText={errors.existingId?.message}
              >
                {clients.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        )}
      </Stack>
      <StepActions onBack={onBack} busy={isSubmitting} submitLabel="Save and continue" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 3: first project from a template (same schema and repo as "New project")
// ---------------------------------------------------------------------------
type ProjectForm = z.input<typeof createProjectSchema>;

function ProjectStep({
  client,
  me,
  onBack,
  onDone,
}: {
  client: Client;
  me: { id: string; name: string };
  onBack: () => void;
  onDone: (p: Project) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectForm>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      key: '',
      clientOrgId: client.id,
      leadId: me.id,
      startDate: today,
      targetDate: '',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 0,
      description: '',
      templateId: TEMPLATES[0].id,
      restricted: false,
    },
  });
  const submit = handleSubmit(async (v) => {
    try {
      const p = await api<Project>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(createProjectSchema.parse(v)),
      });
      await qc.invalidateQueries({ queryKey: qk.projects });
      onDone(p);
    } catch (e) {
      setError((e as Error).message);
    }
  });
  const text = (
    name: keyof ProjectForm,
    label: string,
    props: Record<string, unknown> = {},
    children?: React.ReactNode,
  ) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <TextField
          {...field}
          value={field.value ?? ''}
          label={label}
          fullWidth
          error={!!errors[name]}
          helperText={errors[name]?.message as string | undefined}
          {...props}
        >
          {children}
        </TextField>
      )}
    />
  );
  return (
    <form onSubmit={submit} noValidate aria-labelledby="step-title">
      <Typography variant="h2" id="step-title" gutterBottom>
        Create the first project for {client.name}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Templates set up the five Konnect Delivery Framework gates and their exit criteria for you. You lead
        it for now and can hand it over later.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 8 }}>
          {text('name', 'Project name', { required: true, autoFocus: true })}
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          {text('key', 'Key (e.g. ACME)', {
            required: true,
            slotProps: { htmlInput: { style: { textTransform: 'uppercase' } } },
          })}
        </Grid>
        <Grid size={{ xs: 12 }}>
          {text(
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
        <Grid size={{ xs: 6 }}>
          {text('startDate', 'Start', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}
        </Grid>
        <Grid size={{ xs: 6 }}>
          {text('targetDate', 'Target', {
            type: 'date',
            required: true,
            slotProps: { inputLabel: { shrink: true } },
          })}
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {text(
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
        <Grid size={{ xs: 12, sm: 6 }}>
          {text('contractType', 'Contract', { select: true }, [
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
      </Grid>
      <StepActions onBack={onBack} busy={isSubmitting} submitLabel="Create project" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 4: invite the team
// ---------------------------------------------------------------------------
function InviteStep({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: (invited: Invite[]) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { emails: '', role: 'team_member' },
  });
  const submit = handleSubmit(async (v) => {
    try {
      const invited = await api<Invite[]>('/api/onboarding/invites', {
        method: 'POST',
        body: JSON.stringify(v),
      });
      await onDone(invited);
    } catch (e) {
      setError((e as Error).message);
    }
  });
  const busy = isSubmitting || skipping;
  return (
    <form onSubmit={submit} noValidate aria-labelledby="step-title">
      <Typography variant="h2" id="step-title" gutterBottom>
        Invite your team
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        We record each invite as pending until the person signs in. Clients are invited from their project
        later.
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={2.5}>
        <Controller
          name="emails"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Email addresses"
              multiline
              minRows={3}
              autoFocus
              error={!!errors.emails}
              helperText={errors.emails?.message ?? 'One per line, or separated by commas.'}
            />
          )}
        />
        <Controller
          name="role"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Role">
              {INVITE_ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </MenuItem>
              ))}
            </TextField>
          )}
        />
      </Stack>
      <StepActions
        onBack={onBack}
        busy={busy}
        submitLabel="Send invites and finish"
        extra={
          <Button
            disabled={busy}
            onClick={async () => {
              setSkipping(true);
              try {
                await onDone([]);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSkipping(false);
              }
            }}
          >
            Skip and finish
          </Button>
        }
      />
    </form>
  );
}

/**
 * First-run wizard (ONB-01): workspace name and logo → first client → first project from a
 * template → invite the team. Each step is validated and saved before the next one opens.
 */
export function OnboardingWizard({
  workspace,
  clients,
  me,
}: {
  workspace: WorkspaceSettings;
  clients: Client[];
  me: { id: string; name: string };
}) {
  const [step, setStep] = useState(0);
  const [client, setClient] = useState<Client | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [invited, setInvited] = useState<Invite[] | null>(null);

  // `/` redirects an Admin here only once, even if they leave before finishing.
  useEffect(() => {
    document.cookie = `${ONBOARDING_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
  }, []);

  if (invited) {
    return (
      <Paper sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 4 }} component="section" aria-labelledby="done-title">
        <Stack spacing={2} alignItems="flex-start">
          <CheckCircleOutline color="success" sx={{ fontSize: 40 }} aria-hidden />
          <Typography variant="h1" id="done-title">
            Your workspace is ready
          </Typography>
          <Typography color="text.secondary">
            {project?.name} is set up for {client?.name}
            {invited.length > 0
              ? `, and ${invited.length} ${invited.length === 1 ? 'invite is' : 'invites are'} pending.`
              : '.'}{' '}
            Next, add the first work items to the backlog.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            {project && (
              <Button variant="contained" component={Link} href={`/projects/${project.key}/backlog`}>
                Open {project.key} backlog
              </Button>
            )}
            <Button component={Link} href="/">
              Go to the portfolio
            </Button>
          </Stack>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" gutterBottom>
          Set up your workspace
        </Typography>
        <Typography color="text.secondary">
          Four short steps. You can change everything later in Admin.
        </Typography>
      </Box>
      <Stepper activeStep={step} alternativeLabel aria-label="Setup progress">
        {ONBOARDING_STEPS.map((s) => (
          <Step key={s.id}>
            <StepLabel>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>
      <Typography variant="body2" color="text.secondary" aria-live="polite">
        Step {step + 1} of {ONBOARDING_STEPS.length}: {ONBOARDING_STEPS[step].label}
      </Typography>
      <Paper sx={{ p: { xs: 2, sm: 3 }, borderRadius: 4 }}>
        {step === 0 && <WorkspaceStep workspace={workspace} onDone={() => setStep(1)} />}
        {step === 1 && (
          <ClientStep
            clients={clients}
            onBack={() => setStep(0)}
            onDone={(c) => {
              setClient(c);
              setStep(2);
            }}
          />
        )}
        {step === 2 && project && (
          <Stack spacing={2}>
            <Typography variant="h2">Project created</Typography>
            <Typography color="text.secondary">
              {project.key} · {project.name} is ready. Change its details later from the project page.
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="space-between">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button variant="contained" onClick={() => setStep(3)}>
                Continue
              </Button>
            </Stack>
          </Stack>
        )}
        {step === 2 && client && !project && (
          <ProjectStep
            client={client}
            me={me}
            onBack={() => setStep(1)}
            onDone={(p) => {
              setProject(p);
              setStep(3);
            }}
          />
        )}
        {step === 3 && (
          <InviteStep
            onBack={() => setStep(2)}
            onDone={async (list) => {
              await api('/api/onboarding/complete', { method: 'POST' });
              setInvited(list);
            }}
          />
        )}
      </Paper>
    </Stack>
  );
}
