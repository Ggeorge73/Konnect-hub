'use client';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import { useMe } from '@/lib/client/api';
import { isInternalRole } from '@/lib/domain/permissions';
import { RISK_CATEGORIES } from '@/lib/domain/raid';
import type { RiskSuggestion, RiskSuggestionsResult } from '@/lib/ai/views';
import { ItemKey } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { ScoreChip } from '@/features/raid/RaidChips';
import { useAiStatus, useDecideRisk, useSuggestRisks } from './api';
import { AiDraftChip, AiOffNotice, aiReady } from './AiBits';

const LOOKAHEAD = [
  { days: 0, label: 'As of today' },
  { days: 7, label: 'Looking 7 days ahead' },
  { days: 14, label: 'Looking 14 days ahead' },
  { days: 30, label: 'Looking 30 days ahead' },
];

/**
 * RAID register: "Suggested risks" (KH-43). Signals (stalled items, missed dates, sprint
 * burndown, late deliverables) are detected without AI; Claude turns them into risk suggestions.
 * Accepting creates an internal risk linked to the items; dismissing hides the suggestion for good.
 */
export function SuggestedRisks() {
  const { project } = useProjectBundle();
  const { data: me } = useMe();
  const { data: st } = useAiStatus(project.key);
  const suggest = useSuggestRisks(project.key);
  const decide = useDecideRisk(project.key);
  const [lookahead, setLookahead] = useState(0);
  const [result, setResult] = useState<RiskSuggestionsResult | null>(null);
  const [done, setDone] = useState<Record<string, 'accepted' | 'dismissed'>>({});
  if (!me || !isInternalRole(me.user.role) || !st) return null;
  const ready = aiReady(st, 'risk_suggestions');
  const open = result?.suggestions.filter((s) => !done[s.id]) ?? [];

  const run = () =>
    suggest.mutate(lookahead, {
      onSuccess: (r) => {
        setDone({});
        setResult(r);
      },
    });
  const act = (s: RiskSuggestion, accept: boolean) =>
    decide.mutate(
      { accept, suggestion: s },
      { onSuccess: () => setDone((d) => ({ ...d, [s.id]: accept ? 'accepted' : 'dismissed' })) },
    );

  return (
    <Paper
      component="section"
      aria-labelledby="suggested-risks-heading"
      sx={{ p: 2.5, borderRadius: 4, mb: 2 }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesomeOutlined color="secondary" aria-hidden />
            <Typography variant="h3" component="h2" id="suggested-risks-heading">
              Suggested risks
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Finds stalled work, missed due dates, sprints trending to miss and late deliverables, and drafts
            risks for you to accept or dismiss. Accepted risks are internal and linked to their items.
          </Typography>
        </Box>
        {ready && (
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              label="Signals"
              value={lookahead}
              onChange={(e) => setLookahead(Number(e.target.value))}
              sx={{ minWidth: 210 }}
            >
              {LOOKAHEAD.map((o) => (
                <MenuItem key={o.days} value={o.days}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <Button variant="outlined" color="secondary" onClick={run} disabled={suggest.isPending}>
              {suggest.isPending ? 'Looking…' : 'Find risks'}
            </Button>
          </Stack>
        )}
      </Stack>
      {!ready && (
        <Box sx={{ mt: 2 }}>
          <AiOffNotice status={st} feature="risk_suggestions" />
        </Box>
      )}
      {suggest.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {suggest.error.message}
        </Alert>
      )}
      {decide.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {decide.error.message}
        </Alert>
      )}
      {result && (
        <Box sx={{ mt: 2 }} aria-live="polite">
          {open.length === 0 && (
            <Typography color="text.secondary" data-testid="no-risk-suggestions">
              {result.suggestions.length
                ? 'All suggestions reviewed.'
                : 'No new slipping signals. Look further ahead, or check again after the next status changes.'}
            </Typography>
          )}
          <List disablePadding>
            {open.map((s) => (
              <ListItem
                key={s.id}
                disableGutters
                sx={{ display: 'block', borderTop: 1, borderColor: 'divider', py: 1.5 }}
                data-testid="risk-suggestion"
              >
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={600}>{s.title}</Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={RISK_CATEGORIES.find((c) => c.id === s.category)?.label}
                      />
                      <ScoreChip
                        score={s.probability * s.impact}
                        label={`P${s.probability} × I${s.impact} =`}
                      />
                      <AiDraftChip label="AI suggestion" />
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      <strong>Mitigation:</strong> {s.mitigation}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" component="div">
                      <strong>Why:</strong> {s.because.join(' ')}
                    </Typography>
                    {s.linkedItemKeys.length > 0 && (
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} alignItems="center" flexWrap="wrap">
                        <Typography variant="body2" color="text.secondary">
                          Links:
                        </Typography>
                        {s.linkedItemKeys.map((k) => (
                          <ItemKey key={k} k={k} />
                        ))}
                      </Stack>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => act(s, true)}
                      disabled={decide.isPending}
                      aria-label={`Accept risk: ${s.title}`}
                    >
                      Accept
                    </Button>
                    <Button
                      size="small"
                      onClick={() => act(s, false)}
                      disabled={decide.isPending}
                      aria-label={`Dismiss suggestion: ${s.title}`}
                    >
                      Dismiss
                    </Button>
                  </Stack>
                </Stack>
              </ListItem>
            ))}
          </List>
          {Object.values(done).includes('accepted') && (
            <Alert severity="success" sx={{ mt: 1 }}>
              Accepted risks are in the register below, owned by you and marked internal.
            </Alert>
          )}
        </Box>
      )}
    </Paper>
  );
}
