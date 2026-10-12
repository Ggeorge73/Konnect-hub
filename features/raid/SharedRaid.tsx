'use client';
import { List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material';
import { RAID_STATUS_LABEL, ROAM, type RaidView } from '@/lib/domain/raid';
import { EmptyState } from '@/components/ui/bits';
import { ScoreChip, SeverityChip, SlaBreachedChip } from './RaidChips';

/** Portal section: risks and issues the delivery team has shared with the client. */
export function SharedRaid({ entries }: { entries: RaidView[] }) {
  const rows = entries.filter((e) => e.visibility === 'shared' && (e.kind === 'risk' || e.kind === 'issue'));
  return (
    <Paper sx={{ borderRadius: 4 }} component="section" aria-labelledby="shared-raid-heading">
      <Typography variant="h3" component="h2" sx={{ p: 2 }} id="shared-raid-heading">
        Shared risks and issues
      </Typography>
      {rows.length === 0 ? (
        <EmptyState
          title="No shared risks or issues"
          body="Your delivery team shares the risks and issues that need your attention here."
        />
      ) : (
        <List>
          {rows.map((e) => (
            <ListItem key={e.id} divider>
              <ListItemText
                primary={e.title}
                secondary={[
                  e.kind === 'risk' ? 'Risk' : 'Issue',
                  RAID_STATUS_LABEL[e.status],
                  e.roam ? `ROAM: ${ROAM.find((r) => r.id === e.roam)?.label}` : null,
                  e.mitigation ? `Mitigation: ${e.mitigation}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <Stack direction="row" spacing={1} sx={{ ml: 2 }}>
                {e.kind === 'risk' ? <ScoreChip score={e.score} /> : <SeverityChip severity={e.severity} />}
                {e.slaBreached && <SlaBreachedChip />}
              </Stack>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}
