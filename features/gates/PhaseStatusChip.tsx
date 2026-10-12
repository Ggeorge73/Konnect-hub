'use client';
import { Chip } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import PlaylistAddCheck from '@mui/icons-material/PlaylistAddCheck';
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutline';
import HourglassTop from '@mui/icons-material/HourglassTop';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import type { PhaseStatus } from '@/lib/domain/types';
import { PHASE_STATUS_LABEL } from '@/lib/domain/gates';

const META: Record<
  PhaseStatus,
  { icon: typeof CheckCircle; color: 'success' | 'warning' | 'primary' | 'info' | 'error' | 'default' }
> = {
  not_started: { icon: RadioButtonUnchecked, color: 'default' },
  active: { icon: PlayCircleOutline, color: 'primary' },
  ready_for_review: { icon: HourglassTop, color: 'info' },
  approved: { icon: CheckCircle, color: 'success' },
  approved_with_conditions: { icon: PlaylistAddCheck, color: 'warning' },
  rejected: { icon: ErrorOutline, color: 'error' },
};

/** Phase status: colour + icon + text, never colour alone. */
export function PhaseStatusChip({ status }: { status: PhaseStatus }) {
  const { icon: Icon, color } = META[status];
  return (
    <Chip
      size="small"
      variant="outlined"
      color={color}
      icon={<Icon sx={{ fontSize: 16 }} />}
      label={PHASE_STATUS_LABEL[status]}
      sx={{ fontWeight: 600 }}
    />
  );
}
