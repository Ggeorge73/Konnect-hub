'use client';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import { reauth, reauthStatus } from './api';

export interface DecisionDialogProps {
  open: boolean;
  onClose: () => void;
  /** What is being decided, e.g. "Approve Gate 3 · Execute". */
  title: string;
  description?: React.ReactNode;
  /** Optional free-text field (conditions, reason or note). */
  field?: { label: string; required?: boolean; helper?: string; multiline?: boolean };
  confirmLabel: string;
  confirmColor?: 'primary' | 'error' | 'warning' | 'success';
  onConfirm: (text: string) => Promise<unknown>;
}

/**
 * Confirms a gate or acceptance decision. When the user's re-auth is older than 15 minutes it
 * becomes the "Confirm it's you" step: the user re-enters their email (demo mode), the server sets
 * the signed `kh_reauth` cookie, and the decision is sent, all from one Confirm click.
 */
export function DecisionDialog({
  open,
  onClose,
  title,
  description,
  field,
  confirmLabel,
  confirmColor = 'primary',
  onConfirm,
}: DecisionDialogProps) {
  const [needsReauth, setNeedsReauth] = useState(true);
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
    setEmail('');
    reauthStatus()
      .then((r) => setNeedsReauth(!r.fresh))
      .catch(() => setNeedsReauth(true));
  }, [open]);

  const submit = async () => {
    if (field?.required && !text.trim()) return setError(`${field.label} is required.`);
    if (needsReauth && !email.trim()) return setError('Enter your email to confirm it’s you.');
    setBusy(true);
    setError(null);
    try {
      if (needsReauth) {
        await reauth(email);
        setNeedsReauth(false);
      }
      await onConfirm(text);
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'reauth_required') {
        setNeedsReauth(true);
        setError('Your confirmation expired. Re-enter your email to continue.');
      } else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="decision-title"
    >
      <DialogTitle id="decision-title">
        {needsReauth ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <VerifiedUserOutlined color="primary" />
            <span>Confirm it’s you</span>
          </Stack>
        ) : (
          title
        )}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {needsReauth && (
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
            </Typography>
          )}
          {description}
          {field && (
            <TextField
              label={field.label}
              required={field.required}
              helperText={field.helper}
              multiline={field.multiline}
              minRows={field.multiline ? 3 : undefined}
              value={text}
              onChange={(e) => setText(e.target.value)}
              fullWidth
            />
          )}
          {needsReauth && (
            <>
              <Typography variant="body2" color="text.secondary">
                Approvals are signed decisions. Re-enter your email to confirm it’s you; this stays valid for
                15 minutes. Your name, the time and your IP address are recorded.
              </Typography>
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !field?.multiline && submit()}
                fullWidth
                autoFocus
              />
            </>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color={confirmColor} onClick={submit} disabled={busy}>
          {needsReauth ? `Confirm and ${confirmLabel.toLowerCase()}` : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
