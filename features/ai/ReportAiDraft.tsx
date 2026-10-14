'use client';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import { REPORT_SECTIONS, sanitizeHtml, type ReportSectionId } from '@/lib/domain/reports';
import type { ReportView } from '@/lib/data/reports';
import type { StatusDraftResult } from '@/lib/ai/views';
import { useUpdateReport } from '@/features/reports/api';
import { useAiStatus, useDraftReport } from './api';
import { aiOffReason, AiDraftChip } from './AiBits';

const Html = ({ html, label }: { html: string; label: string }) => (
  <Box
    aria-label={label}
    role="region"
    sx={{ '& p': { my: 0.5 }, '& ul': { my: 0.5, pl: 2.5 }, fontSize: 14, minHeight: 24 }}
    dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) || '<p>—</p>' }}
  />
);

/**
 * "Draft with AI" on the report editor (KH-42). The draft is a preview: the Lead accepts it per
 * section or as a whole, and only then is it saved through the normal report update.
 */
export function ReportAiDraft({ report }: { report: ReportView }) {
  const { data: st } = useAiStatus(report.projectKey);
  const draft = useDraftReport(report.id);
  const update = useUpdateReport(report.id);
  const [result, setResult] = useState<StatusDraftResult | null>(null);
  const [accepted, setAccepted] = useState<Set<ReportSectionId>>(new Set());
  if (!report.canEdit || !st) return null;
  const reason = aiOffReason(st, 'status_report');
  const sections = REPORT_SECTIONS.filter((s) => result?.sections[s.id] !== undefined);
  const pending = sections.filter((s) => !accepted.has(s.id));

  const run = () =>
    draft.mutate(undefined, {
      onSuccess: (r) => {
        setAccepted(new Set());
        setResult(r);
      },
    });
  const accept = (ids: ReportSectionId[]) => {
    if (!result || !ids.length) return;
    const patch = Object.fromEntries(ids.map((id) => [id, result.sections[id]!]));
    update.mutate(
      { sections: patch },
      { onSuccess: () => setAccepted((prev) => new Set([...prev, ...ids])) },
    );
  };

  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Tooltip
          title={reason ?? 'Claude polishes each section from this week’s facts. You review before saving.'}
        >
          <span>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<AutoAwesomeOutlined />}
              onClick={run}
              disabled={Boolean(reason) || draft.isPending}
            >
              {draft.isPending ? 'Drafting…' : 'Draft with AI'}
            </Button>
          </span>
        </Tooltip>
        {reason && (
          <Typography variant="body2" color="text.secondary" data-testid="ai-off-reason">
            {reason}
          </Typography>
        )}
      </Stack>
      {draft.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {draft.error.message}
        </Alert>
      )}
      <Dialog
        open={Boolean(result)}
        onClose={() => setResult(null)}
        maxWidth="lg"
        fullWidth
        aria-labelledby="ai-draft-title"
      >
        <DialogTitle id="ai-draft-title">
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <span>AI draft of the status report</span>
            <AiDraftChip />
          </Stack>
        </DialogTitle>
        <DialogContent dividers data-testid="ai-draft-preview">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Compare each section with the current text. Nothing changes until you accept a section. Accepted
            text can still be edited, and the client copy is still redacted when you publish.
          </Typography>
          <Stack spacing={2}>
            {sections.map((s) => {
              const done = accepted.has(s.id);
              return (
                <Paper
                  key={s.id}
                  variant="outlined"
                  sx={{ p: 2, borderRadius: 3 }}
                  component="section"
                  aria-labelledby={`ai-sec-${s.id}`}
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="h3" component="h3" id={`ai-sec-${s.id}`} sx={{ flex: 1 }}>
                      {s.label}
                    </Typography>
                    {done ? (
                      <Typography
                        color="success.main"
                        variant="body2"
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                      >
                        <CheckOutlined fontSize="small" aria-hidden /> Accepted
                      </Typography>
                    ) : (
                      <Button size="small" onClick={() => accept([s.id])} disabled={update.isPending}>
                        Accept {s.label.toLowerCase()}
                      </Button>
                    )}
                  </Stack>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="caption" color="text.secondary">
                        Current
                      </Typography>
                      <Html html={report.sections[s.id] ?? ''} label={`Current ${s.label} section`} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="caption" color="secondary.main">
                        AI draft
                      </Typography>
                      <Html html={result!.sections[s.id]!} label={`AI draft of the ${s.label} section`} />
                    </Grid>
                  </Grid>
                </Paper>
              );
            })}
          </Stack>
          {update.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {update.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResult(null)}>{pending.length ? 'Discard the rest' : 'Close'}</Button>
          <Button
            variant="contained"
            onClick={() => accept(pending.map((s) => s.id))}
            disabled={!pending.length || update.isPending}
          >
            Accept all
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
