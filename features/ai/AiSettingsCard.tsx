'use client';
import {
  Alert,
  Box,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useAiStatus, useToggleAi } from './api';
import { AiProviderNote } from './AiBits';

const FEATURES = [
  ['Status report drafts', 'Polishes the weekly report; the Lead accepts each section.'],
  ['Risk suggestions', 'Turns stalled items and slipping dates into risks you accept or dismiss.'],
  ['Meeting notes to items', 'Proposes work items from pasted notes; you tick the ones to create.'],
  ['Thread summaries', 'Summarises long comment threads. Client summaries use shared comments only.'],
] as const;

/** Project Overview: the per-project AI switch (off by default; Lead or Admin only, audited). */
export function AiSettingsCard() {
  const { project } = useProjectBundle();
  const { data: st } = useAiStatus(project.key);
  const toggle = useToggleAi(project.key);
  if (!st) return null;
  const unavailable = st.provider === 'unavailable';
  return (
    <Paper component="section" aria-labelledby="ai-settings-heading" sx={{ p: 2.5, borderRadius: 4, mt: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesomeOutlined color="secondary" aria-hidden />
            <Typography variant="h3" component="h2" id="ai-settings-heading">
              AI assist
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Claude drafts; people decide. Nothing AI writes is saved until someone on the team accepts it, and
            internal items, comments and budgets never go into anything a client sees.
          </Typography>
          <List dense disablePadding sx={{ mt: 1 }}>
            {FEATURES.map(([name, body]) => (
              <ListItem key={name} disableGutters>
                <ListItemText primary={name} secondary={body} />
              </ListItem>
            ))}
          </List>
        </Box>
        <Stack spacing={1} sx={{ minWidth: { md: 300 } }}>
          <FormControlLabel
            control={
              <Switch
                checked={st.enabled}
                disabled={!st.canToggle || unavailable || toggle.isPending}
                onChange={(e) => toggle.mutate(e.target.checked)}
              />
            }
            label={st.enabled ? 'AI assist is on' : 'AI assist is off'}
          />
          <Typography variant="body2" color="text.secondary">
            {st.updatedAt
              ? `Last changed by ${st.updatedByName ?? 'someone'} on ${new Date(st.updatedAt).toLocaleDateString()}.`
              : 'Off by default for every project.'}
            {!st.canToggle && ' Only the project’s Delivery Lead or an Admin can change this.'}
          </Typography>
          {unavailable && <Alert severity="warning">{st.note}</Alert>}
          <AiProviderNote status={st} />
          {toggle.error && <Alert severity="error">{toggle.error.message}</Alert>}
        </Stack>
      </Stack>
    </Paper>
  );
}
