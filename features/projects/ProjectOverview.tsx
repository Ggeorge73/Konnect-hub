'use client';
import { List, ListItem, ListItemText, Paper, Stack, Typography, Box, Chip } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { useActivity, useItems, useMe } from '@/lib/client/api';
import { useProjectBundle } from './ProjectFrame';
import { EmptyState, Mono } from '@/components/ui/bits';
import { canSeeFinancials } from '@/lib/domain/permissions';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { CalendarSubscribeButton } from '@/features/notifications/CalendarSubscribeButton';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ProjectOverview() {
  const b = useProjectBundle();
  const { data: items = [] } = useItems(b.project.id);
  const { data: activity = [] } = useActivity(b.project.key);
  const { data: me } = useMe();
  const work = items.filter((i) => i.type !== 'epic' && i.type !== 'feature');
  const done = work.filter((i) => i.status === 'done' || i.status === 'accepted').length;
  const current = b.phases.find((p) => p.status !== 'approved' && p.status !== 'approved_with_conditions');
  const crit = b.criteria.filter((c) => c.phaseId === current?.id);
  const upcoming = [
    ...b.sprints
      .filter((s) => s.status !== 'completed')
      .map((s) => ({ name: `${s.name} ends`, date: s.endDate })),
    { name: 'Target date', date: b.project.targetDate },
  ]
    .sort((a, c) => a.date.localeCompare(c.date))
    .slice(0, 4);
  const metrics = [
    { label: 'Complete', value: `${work.length ? Math.round((done / work.length) * 100) : 0}%` },
    { label: 'Open items', value: work.length - done },
    {
      label: 'Critical open',
      value: work.filter((i) => i.priority === 'critical' && i.status !== 'done' && i.status !== 'accepted')
        .length,
    },
    { label: 'In client review', value: work.filter((i) => i.status === 'client_review').length },
    ...(me && canSeeFinancials(me.user) ? [{ label: 'Budget (BAC)', value: usd(b.project.bac) }] : []),
  ];
  return (
    <Grid container spacing={2}>
      {metrics.map((m) => (
        <Grid key={m.label} size={{ xs: 6, md: 12 / metrics.length }}>
          <Paper sx={{ p: 2, borderRadius: 4 }}>
            <Typography variant="caption" color="text.secondary">
              {m.label}
            </Typography>
            <Typography variant="h2">
              <Mono>{m.value}</Mono>
            </Typography>
          </Paper>
        </Grid>
      ))}
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper sx={{ p: 2, borderRadius: 4, height: '100%' }}>
          <Typography variant="h3" gutterBottom>
            Gate {current?.gate}: {current?.name} — exit criteria
          </Typography>
          <List dense>
            {crit.map((c) => (
              <ListItem key={c.id} disableGutters>
                <Chip
                  size="small"
                  label={c.done ? 'Done' : 'Open'}
                  color={c.done ? 'success' : 'default'}
                  variant="outlined"
                  sx={{ mr: 1.5, minWidth: 56 }}
                />
                <ListItemText primary={c.text} />
              </ListItem>
            ))}
          </List>
          <Typography variant="h3" sx={{ mt: 2 }} gutterBottom>
            Upcoming milestones
          </Typography>
          <CalendarSubscribeButton projectKey={b.project.key} />
          <List dense>
            {upcoming.map((u) => (
              <ListItem key={u.name} disableGutters>
                <ListItemText primary={u.name} secondary={<Mono>{u.date}</Mono>} />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper sx={{ p: 2, borderRadius: 4, height: '100%' }}>
          <Typography variant="h3" gutterBottom>
            Recent activity
          </Typography>
          {activity.length === 0 ? (
            <EmptyState title="Quiet so far" body="Activity appears here as the team moves work." />
          ) : (
            <List dense>
              {activity.slice(0, 10).map((a) => (
                <ListItem key={a.id} disableGutters>
                  <ListItemText
                    primary={a.detail}
                    secondary={
                      <Box component="span">
                        <Mono>{new Date(a.at).toLocaleString()}</Mono>
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
            {Object.entries(STATUS_LABEL).map(([s, l]) => (
              <Chip
                key={s}
                size="small"
                variant="outlined"
                label={`${l}: ${work.filter((i) => i.status === s).length}`}
                sx={{ mb: 1 }}
              />
            ))}
          </Stack>
        </Paper>
      </Grid>
    </Grid>
  );
}
