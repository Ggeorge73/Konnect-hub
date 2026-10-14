'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddCommentOutlined from '@mui/icons-material/AddCommentOutlined';
import { api } from '@/lib/client/api';
import { ItemKey } from '@/components/ui/bits';
import type { WorkItem } from '@/lib/domain/types';
import { clientRequestSchema, REQUEST_PRIORITIES, toCreateItem } from '@/lib/domain/portal';

type Form = z.input<typeof clientRequestSchema>;

/**
 * "Submit a request": creates a shared Client Request in the project's backlog through the normal
 * item path (POST /api/items → repo.createItem; on Postgres the create_client_request RPC).
 */
export function RequestDialog({
  open,
  onClose,
  projects,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  projects: { id: string; key: string; name: string }[];
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<WorkItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(clientRequestSchema),
    defaultValues: {
      projectId: defaultProjectId ?? (projects.length === 1 ? projects[0].id : ''),
      title: '',
      description: '',
      priority: 'medium',
    },
  });

  const close = () => {
    onClose();
    // Reset after the close transition so the confirmation does not flash back to the form.
    setTimeout(() => {
      setCreated(null);
      setError(null);
      reset();
    }, 200);
  };

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const item = await api<WorkItem>('/api/items', {
        method: 'POST',
        body: JSON.stringify(toCreateItem(clientRequestSchema.parse(v))),
      });
      setCreated(item);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  const project = projects.find((p) => p.id === created?.projectId);

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="request-title">
      {created ? (
        <>
          <DialogTitle id="request-title">Request submitted</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5} role="status">
              <Typography>
                Thanks — your request was logged as <ItemKey k={created.key} />.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                “{created.title}” is in the {project?.name ?? 'project'} backlog. Your delivery team will
                triage it and you can follow it under Work on the project page.
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            {project && (
              <Button
                onClick={() => {
                  close();
                  router.push(`/portal/${project.key}?item=${created.key}`);
                }}
              >
                View request
              </Button>
            )}
            <Button variant="contained" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <DialogTitle id="request-title">Submit a request</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Ask for a change, report a problem or raise a question. It goes straight into the project
                backlog for your delivery team.
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              <Controller
                name="projectId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Project"
                    required
                    error={!!errors.projectId}
                    helperText={errors.projectId?.message}
                  >
                    {projects.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="title"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Title"
                    required
                    autoFocus
                    error={!!errors.title}
                    helperText={errors.title?.message ?? 'One line that sums up the request'}
                  />
                )}
              />
              <Controller
                name="description"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Description"
                    multiline
                    minRows={3}
                    error={!!errors.description}
                    helperText={
                      errors.description?.message ?? 'What do you need, and why? Links are welcome.'
                    }
                  />
                )}
              />
              <Controller
                name="priority"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Priority" error={!!errors.priority}>
                    {REQUEST_PRIORITIES.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              Submit request
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

/** Button + dialog, for the portal home and project pages. */
export function SubmitRequestButton({
  projects,
  defaultProjectId,
  variant = 'contained',
}: {
  projects: { id: string; key: string; name: string }[];
  defaultProjectId?: string;
  variant?: 'contained' | 'outlined';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        startIcon={<AddCommentOutlined />}
        onClick={() => setOpen(true)}
        disabled={projects.length === 0}
      >
        Submit a request
      </Button>
      <RequestDialog
        open={open}
        onClose={() => setOpen(false)}
        projects={projects}
        defaultProjectId={defaultProjectId}
      />
    </>
  );
}
