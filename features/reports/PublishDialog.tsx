'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Skeleton,
  Switch,
  Typography,
} from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { REPORT_SECTIONS, type ReportSectionId } from '@/lib/domain/reports';
import type { ReportView } from '@/lib/data/reports';
import { usePublishCheck, usePublishReport } from './api';

const sectionLabel = (id: ReportSectionId | 'rag') =>
  id === 'rag' ? 'RAG reason' : (REPORT_SECTIONS.find((s) => s.id === id)?.label ?? id);

/** Pre-publish checklist: what the client copy leaves out, who is notified, then publish. */
export function PublishDialog({
  report,
  open,
  onClose,
}: {
  report: ReportView;
  open: boolean;
  onClose: () => void;
}) {
  const [shareBudget, setShareBudget] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const check = usePublishCheck(report.id, shareBudget, open);
  const publish = usePublishReport(report.id);

  const close = () => {
    setConfirmed(false);
    publish.reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="publish-title">
      <DialogTitle id="publish-title">Publish to the client portal</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 1.5 }}>
          The client sees a copy of this report. Internal content is removed automatically.
        </Typography>
        <FormControlLabel
          control={<Switch checked={shareBudget} onChange={(e) => setShareBudget(e.target.checked)} />}
          label="Share the budget section with the client"
        />
        <Typography variant="h3" component="h3" sx={{ mt: 2, mb: 0.5 }}>
          Will be removed from the client copy
        </Typography>
        {check.error && <Alert severity="error">{check.error.message}</Alert>}
        {check.isLoading || !check.data ? (
          <Skeleton variant="rounded" height={80} />
        ) : check.data.removed.length === 0 ? (
          <Typography>Nothing: this report has no internal content.</Typography>
        ) : (
          <List dense aria-label="Removed from the client copy">
            {check.data.removed.map((r) => (
              <ListItem key={`${r.section}-${r.label}`} disableGutters>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <LockOutlined fontSize="small" color="warning" />
                </ListItemIcon>
                <ListItemText primary={r.label} secondary={`${sectionLabel(r.section)} section`} />
              </ListItem>
            ))}
          </List>
        )}
        {check.data && (
          <Typography sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleOutline fontSize="small" color="primary" />
            {check.data.recipients} client {check.data.recipients === 1 ? 'user is' : 'users are'} notified
            when you publish.
          </Typography>
        )}
        <FormControlLabel
          sx={{ mt: 1.5 }}
          control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />}
          label="I have reviewed the report and it is ready for the client"
        />
        {publish.error && (
          <Alert severity="error" role="alert" sx={{ mt: 1 }}>
            {publish.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!confirmed || publish.isPending || !check.data}
          onClick={() => publish.mutate({ shareBudget }, { onSuccess: close })}
        >
          Publish report
        </Button>
      </DialogActions>
    </Dialog>
  );
}
