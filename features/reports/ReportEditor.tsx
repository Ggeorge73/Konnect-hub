'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublishOutlined from '@mui/icons-material/PublishOutlined';
import { RichText } from '@/components/ui/RichText';
import { RagChip } from '@/components/ui/bits';
import { REPORT_SECTIONS } from '@/lib/domain/reports';
import type { Rag } from '@/lib/domain/types';
import { useReport, useUpdateReport } from './api';
import { fmtWeek, ReportStatusChip } from './bits';
import { PublishDialog } from './PublishDialog';
import { ReportAiDraft } from '@/features/ai/ReportAiDraft';

const RAG_OPTIONS: { id: Rag; label: string }[] = [
  { id: 'green', label: 'Green · On track' },
  { id: 'amber', label: 'Amber · At risk' },
  { id: 'red', label: 'Red · Off track' },
];

/** The Lead edits each section in Tiptap (saved on blur), then publishes through the checklist. */
export function ReportEditor({ id }: { id: string }) {
  const { data: r, isLoading, error } = useReport(id);
  const update = useUpdateReport(id);
  const [publishing, setPublishing] = useState(false);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !r) return <Skeleton variant="rounded" height={320} />;
  const sections = REPORT_SECTIONS.filter((s) => s.id !== 'budget' || !r.budgetHidden);

  return (
    <Stack spacing={2}>
      <Box>
        <Button component={Link} href="/reports" startIcon={<ArrowBack />} size="small">
          All reports
        </Button>
      </Box>
      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Weekly status report · {r.projectKey}
            </Typography>
            <Typography variant="h1">
              {r.projectName}, week of {fmtWeek(r.weekStart)}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap">
              <ReportStatusChip status={r.status} />
              <RagChip rag={r.rag} />
              <Typography variant="body2" color="text.secondary">
                Drafted by {r.authorName}
                {r.publishedAt &&
                  ` · Published by ${r.publishedByName} on ${new Date(r.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
              </Typography>
            </Stack>
          </Box>
          {r.canPublish && (
            <Button variant="contained" startIcon={<PublishOutlined />} onClick={() => setPublishing(true)}>
              Publish…
            </Button>
          )}
        </Stack>
        {r.status === 'draft' && !r.canPublish && (
          <Alert severity="info" sx={{ mt: 2 }}>
            You can edit this draft. Only the project’s Delivery Lead or an Admin can publish it.
          </Alert>
        )}
        {r.canEdit && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
            <TextField
              select
              label="RAG status"
              value={r.rag}
              onChange={(e) => update.mutate({ rag: e.target.value as Rag })}
              sx={{ minWidth: 200 }}
              size="small"
            >
              {RAG_OPTIONS.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="RAG reason"
              defaultValue={r.ragReason}
              key={r.ragReason}
              size="small"
              fullWidth
              onBlur={(e) => e.target.value !== r.ragReason && update.mutate({ ragReason: e.target.value })}
            />
          </Stack>
        )}
        {r.canEdit && (
          <Box sx={{ mt: 2 }}>
            <ReportAiDraft report={r} />
          </Box>
        )}
        {!r.canEdit && r.ragReason && (
          <Typography sx={{ mt: 1.5 }}>
            <strong>RAG reason:</strong> {r.ragReason}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ mt: 1, minHeight: 20 }}>
          {update.isPending ? 'Saving…' : update.isSuccess ? 'All changes saved' : ''}
        </Typography>
        {update.error && <Alert severity="error">{update.error.message}</Alert>}
      </Paper>

      {sections.map((s) => (
        <Paper
          key={s.id}
          component="section"
          aria-labelledby={`section-${s.id}`}
          sx={{ p: 2.5, borderRadius: 4 }}
          data-testid={`report-section-${s.id}`}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h3" component="h2" id={`section-${s.id}`}>
              {s.label}
            </Typography>
            {s.internalOnly && (
              <Chip
                size="small"
                icon={<LockOutlined sx={{ fontSize: 14 }} />}
                label={r.shareBudget && r.status === 'published' ? 'Shared with client' : 'Internal only'}
                variant="outlined"
              />
            )}
          </Stack>
          <RichText
            value={r.sections[s.id] ?? ''}
            editable={r.canEdit}
            label={`${s.label} section`}
            onSave={(html) => update.mutate({ sections: { [s.id]: html } })}
          />
        </Paper>
      ))}

      {r.status === 'published' && r.removed.length > 0 && (
        <Paper sx={{ p: 2.5, borderRadius: 4 }} component="section" aria-labelledby="removed-heading">
          <Typography variant="h3" component="h2" id="removed-heading">
            Left out of the client copy
          </Typography>
          <List dense>
            {r.removed.map((x) => (
              <ListItem key={`${x.section}-${x.label}`} disableGutters>
                <ListItemText primary={x.label} />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      {r.canPublish && <PublishDialog report={r} open={publishing} onClose={() => setPublishing(false)} />}
    </Stack>
  );
}
