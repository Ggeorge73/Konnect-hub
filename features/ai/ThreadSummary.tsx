'use client';
import { Alert, Box, Button, List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import { SUMMARY_MIN_COMMENTS } from '@/lib/domain/ai';
import { useAiStatus, useThreadSummary } from './api';
import { AiDraftChip, aiReady } from './AiBits';

/**
 * "Summarize thread" in the item panel (KH-44), for threads with more than five comments. The
 * summary is built from the comments the viewer can see (clients: shared only) and is shown, not
 * stored.
 */
export function ThreadSummary({
  itemKey,
  projectKey,
  commentCount,
}: {
  itemKey: string;
  projectKey: string | undefined;
  commentCount: number;
}) {
  const { data: st } = useAiStatus(projectKey);
  const summary = useThreadSummary(itemKey);
  if (commentCount < SUMMARY_MIN_COMMENTS || !aiReady(st, 'thread_summary')) return null;
  const s = summary.data;
  return (
    <Box sx={{ py: 1.5 }}>
      {!s && (
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={<AutoAwesomeOutlined />}
          onClick={() => summary.mutate()}
          disabled={summary.isPending}
        >
          {summary.isPending ? 'Summarizing…' : 'Summarize thread'}
        </Button>
      )}
      {summary.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {summary.error.message}
        </Alert>
      )}
      {s && (
        <Paper
          variant="outlined"
          sx={{ p: 1.5, borderRadius: 3 }}
          component="section"
          aria-labelledby="thread-summary-heading"
          data-testid="thread-summary"
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" component="h3" id="thread-summary-heading">
              Thread summary
            </Typography>
            <AiDraftChip label="AI summary · not saved" />
          </Stack>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {s.summary}
          </Typography>
          {s.keyPoints.length > 0 && (
            <List dense disablePadding>
              {s.keyPoints.map((p, i) => (
                <ListItem key={i} disableGutters sx={{ display: 'list-item', ml: 2, listStyleType: 'disc' }}>
                  <ListItemText primary={p} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItem>
              ))}
            </List>
          )}
          <Typography variant="caption" color="text.secondary">
            Built from {s.commentCount} {s.scope === 'shared' ? 'shared ' : ''}comments.
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
