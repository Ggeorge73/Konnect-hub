'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
} from '@mui/material';
import { useCreateItem, useProjects, useMe } from '@/lib/client/api';
import { ITEM_TYPES, PRIORITIES } from '@/lib/domain/workflow';
import type { ItemType, Priority, Visibility } from '@/lib/domain/types';
import { isClientRole } from '@/lib/domain/permissions';

export function QuickCreate({
  open,
  onClose,
  projectKey,
}: {
  open: boolean;
  onClose: () => void;
  projectKey?: string;
}) {
  const { data: projects = [] } = useProjects();
  const { data: me } = useMe();
  const client = me ? isClientRole(me.user.role) : false;
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ItemType>('story');
  const [priority, setPriority] = useState<Priority>('medium');
  const [visibility, setVisibility] = useState<Visibility>('internal');
  const create = useCreateItem(projectId);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const p = projects.find((x) => x.key === projectKey) ?? projects[0];
    if (p) setProjectId(p.id);
    if (client) setType('client_request');
  }, [open, projectKey, projects, client]);

  const submit = async () => {
    const item = await create.mutateAsync({ projectId, title, type, priority, visibility });
    const key = projects.find((p) => p.id === projectId)?.key;
    setTitle('');
    onClose();
    router.push(`/projects/${key}/board?item=${item.key}`);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{client ? 'Submit a request' : 'Create work item'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {create.error && <Alert severity="error">{create.error.message}</Alert>}
          <TextField select label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.key} · {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            autoFocus
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            onKeyDown={(e) => e.key === 'Enter' && title.trim() && submit()}
          />
          {!client && (
            <Stack direction="row" spacing={2}>
              <TextField
                select
                fullWidth
                label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as ItemType)}
              >
                {ITEM_TYPES.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label="Visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as Visibility)}
              >
                <MenuItem value="internal">Internal</MenuItem>
                <MenuItem value="shared">Shared with client</MenuItem>
              </TextField>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!title.trim() || !projectId || create.isPending}
          onClick={submit}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
