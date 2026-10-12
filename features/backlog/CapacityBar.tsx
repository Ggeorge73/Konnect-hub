'use client';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { capacity as computeCapacity, type CapacityLevel } from '@/lib/domain/sprints';
import { MONO } from '@/lib/theme';

const LEVEL: Record<
  CapacityLevel,
  { color: 'success' | 'warning' | 'error' | 'inherit'; Icon: typeof CheckCircle }
> = {
  none: { color: 'inherit', Icon: InfoOutlined },
  ok: { color: 'success', Icon: CheckCircle },
  over: { color: 'warning', Icon: WarningAmber },
  critical: { color: 'error', Icon: ErrorOutline },
};

/** Planned vs available hours. Colour is paired with an icon and a text label. */
export function CapacityBar({
  sprintName,
  planned,
  available,
}: {
  sprintName: string;
  planned: number;
  available?: number | null;
}) {
  const c = computeCapacity(planned, available);
  const { color, Icon } = LEVEL[c.level];
  return (
    <Box sx={{ minWidth: 220, flex: 1, maxWidth: 360 }} data-testid={`capacity-${sprintName}`}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
        <Icon
          aria-hidden
          sx={{ fontSize: 16, color: color === 'inherit' ? 'text.secondary' : `${color}.main` }}
        />
        <Typography variant="caption" sx={{ fontFamily: MONO }} data-level={c.level}>
          {c.label}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={c.ratio === null ? 0 : Math.min(100, c.ratio * 100)}
        color={color}
        aria-label={`Capacity for ${sprintName}`}
        aria-valuetext={c.label}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
}
