'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import type { Rag } from '@/lib/domain/types';
import { RAG_TEXT } from '@/lib/domain/dashboard';
import { RagChip } from '@/components/ui/bits';
import { usePatchDashboard } from './api';

/** Lead/Admin override of the RAG status. A reason is required and the change is audited. */
export function RagOverrideDialog({
  projectKey,
  current,
  suggested,
  open,
  onClose,
}: {
  projectKey: string;
  current: Rag;
  suggested?: Rag;
  open: boolean;
  onClose: () => void;
}) {
  const [rag, setRag] = useState<Rag>(current);
  const [reason, setReason] = useState('');
  const patch = usePatchDashboard(projectKey);
  const save = () =>
    patch.mutate(
      { rag, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('');
          onClose();
        },
      },
    );
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="rag-override-title">
      <DialogTitle id="rag-override-title">Set RAG status</DialogTitle>
      <DialogContent>
        {suggested && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The rules suggest {RAG_TEXT[suggested]}. Your choice and reason are recorded in the audit log and
            the reason is shown to the client on the portal dashboard.
          </Typography>
        )}
        <FormControl>
          <FormLabel id="rag-choice">Status</FormLabel>
          <RadioGroup
            row
            aria-labelledby="rag-choice"
            value={rag}
            onChange={(e) => setRag(e.target.value as Rag)}
          >
            {(['green', 'amber', 'red'] as Rag[]).map((r) => (
              <FormControlLabel
                key={r}
                value={r}
                control={<Radio inputProps={{ 'aria-label': RAG_TEXT[r] }} />}
                label={<RagChip rag={r} />}
              />
            ))}
          </RadioGroup>
        </FormControl>
        <TextField
          label="Reason"
          required
          fullWidth
          multiline
          minRows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          inputProps={{ maxLength: 500 }}
          helperText="Required. What changed, and what is being done about it."
          sx={{ mt: 2 }}
        />
        {patch.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {patch.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!reason.trim() || patch.isPending}>
          Save status
        </Button>
      </DialogActions>
    </Dialog>
  );
}
