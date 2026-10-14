'use client';
import { Chip } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import HourglassEmptyOutlined from '@mui/icons-material/HourglassEmptyOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import { TIME_STATUS_LABEL, type TimeStatus } from '@/lib/domain/ledger';

const ICON = {
  draft: <EditOutlined />,
  submitted: <HourglassEmptyOutlined />,
  approved: <LockOutlined />,
  rejected: <ReplayOutlined />,
};
const COLOR = { draft: 'default', submitted: 'info', approved: 'success', rejected: 'error' } as const;

/** Status of a time entry: colour + icon + text. Approved shows a lock (it can't be edited). */
export function TimeStatusChip({ status }: { status: TimeStatus }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={COLOR[status]}
      icon={ICON[status]}
      label={TIME_STATUS_LABEL[status]}
      title={status === 'approved' ? 'Approved and locked' : undefined}
    />
  );
}
