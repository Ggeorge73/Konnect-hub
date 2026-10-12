'use client';
import { Box, Stack, Typography } from '@mui/material';
import { RAID_KINDS, RAID_STATUS_LABEL } from '@/lib/domain/raid';
import { useItemRaid } from './api';
import { EscalateChip, ScoreChip, SeverityChip, SlaBreachedChip, StaleChip } from './RaidChips';

/** Small read-only section for the item side panel: RAID entries that link to this item. */
export function LinkedRaid({ itemKey }: { itemKey: string }) {
  const { data = [] } = useItemRaid(itemKey);
  if (!data.length) return null;
  return (
    <Box sx={{ mt: 2.5 }} component="section" aria-labelledby="linked-raid-heading">
      <Typography variant="subtitle2" id="linked-raid-heading">
        Linked RAID entries
      </Typography>
      {data.map((e) => (
        <Stack
          key={e.id}
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          sx={{ py: 0.5 }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72 }}>
            {RAID_KINDS.find((k) => k.id === e.kind)!.label}
          </Typography>
          {e.kind === 'risk' && <ScoreChip score={e.score} />}
          {e.kind === 'issue' && <SeverityChip severity={e.severity} />}
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
            {e.title}
          </Typography>
          {e.escalate && e.status !== 'closed' && <EscalateChip />}
          {e.slaBreached && <SlaBreachedChip />}
          {e.stale && <StaleChip />}
          <Typography variant="caption" color="text.secondary">
            {RAID_STATUS_LABEL[e.status]}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}
