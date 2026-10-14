'use client';
import Link from 'next/link';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import { EmptyState, Mono } from '@/components/ui/bits';
import { MILESTONE_KIND_LABEL, type Milestone, type MilestoneKind } from '@/lib/domain/portal';

const ICON: Record<MilestoneKind, typeof FlagOutlined> = {
  sprint: FlagOutlined,
  gate: GavelOutlined,
  deliverable: Inventory2Outlined,
};

const fmt = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Read-only mini-timeline of upcoming sprint ends, gates and deliverable due dates. */
export function MilestonesTimeline({
  projectKey,
  milestones,
}: {
  projectKey: string;
  milestones: Milestone[];
}) {
  return (
    <Paper
      id="milestones"
      component="section"
      aria-labelledby="milestones-title"
      sx={{ borderRadius: 4, p: 2, scrollMarginTop: 120 }}
    >
      <Typography variant="h3" component="h2" id="milestones-title" sx={{ mb: 1 }}>
        Milestones
      </Typography>
      {milestones.length === 0 ? (
        <EmptyState
          title="No upcoming milestones"
          body="Sprint ends, gate dates and deliverable due dates appear here once your delivery team schedules them."
          action={
            <Button variant="outlined" component={Link} href={`/portal/${projectKey}/dashboard`}>
              Open the dashboard
            </Button>
          }
        />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, position: 'relative' }}>
          {milestones.map((m, i) => {
            const Icon = ICON[m.kind];
            return (
              <Stack
                key={`${m.kind}-${m.id}`}
                component="li"
                direction="row"
                spacing={1.5}
                sx={{ position: 'relative', pb: i === milestones.length - 1 ? 0 : 2 }}
                data-testid={`milestone-${m.kind}`}
              >
                <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      border: 2,
                      borderColor: 'primary.main',
                      color: 'primary.main',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                    aria-hidden
                  >
                    <Icon sx={{ fontSize: 18 }} />
                  </Box>
                  {i < milestones.length - 1 && (
                    <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', mt: 0.5 }} aria-hidden />
                  )}
                </Stack>
                <Box sx={{ minWidth: 0, pt: 0.5 }}>
                  <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                    {m.title}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
                    <Chip size="small" variant="outlined" label={MILESTONE_KIND_LABEL[m.kind]} />
                    <Typography variant="body2" color="text.secondary">
                      <Mono>{fmt(m.date)}</Mono>
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
