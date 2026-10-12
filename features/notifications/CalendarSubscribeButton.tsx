'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import EventOutlined from '@mui/icons-material/EventOutlined';
import { api } from '@/lib/client/api';

/**
 * "Subscribe to calendar" (ICS-01): copies the user's personal feed URL for this project.
 * The dialog shows the URL too, for browsers that block clipboard access.
 */
export function CalendarSubscribeButton({ projectKey }: { projectKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    try {
      const { path } = await api<{ path: string }>(`/api/projects/${projectKey}/calendar`);
      const full = new URL(path, window.location.origin).toString();
      setUrl(full);
      try {
        await navigator.clipboard.writeText(full);
        setCopied(true);
      } catch {
        setCopied(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<EventOutlined />} onClick={open}>
        Subscribe to calendar
      </Button>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      <Dialog open={Boolean(url)} onClose={() => setUrl(null)} fullWidth maxWidth="sm">
        <DialogTitle>Subscribe to {projectKey} milestones</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {copied ? 'The feed URL is copied. ' : ''}Add it in Outlook, Google Calendar or Apple Calendar as
            a calendar from a URL. It shows sprint ends, deliverable due dates, gate reviews and the target
            date, and updates automatically. The link is personal: do not share it.
          </Typography>
          <TextField
            fullWidth
            label="Calendar feed URL"
            value={url ?? ''}
            slotProps={{
              htmlInput: {
                readOnly: true,
                onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select(),
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={async () => {
              if (!url) return;
              await navigator.clipboard.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? 'Copied' : 'Copy URL'}
          </Button>
          <Button variant="contained" onClick={() => setUrl(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
