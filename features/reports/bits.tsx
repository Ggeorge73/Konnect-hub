'use client';
import { Chip } from '@mui/material';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import type { ReportStatus } from '@/lib/domain/reports';
import { RAG_COLORS } from '@/lib/theme';

export const fmtWeek = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Draft / Published, always icon + text (text stays in the text colour for contrast). */
export function ReportStatusChip({ status }: { status: ReportStatus }) {
  return status === 'published' ? (
    <Chip
      size="small"
      variant="outlined"
      icon={<PublicOutlined sx={{ color: `${RAG_COLORS.green} !important` }} />}
      label="Published"
      sx={{ borderColor: RAG_COLORS.green, cursor: 'inherit' }}
    />
  ) : (
    <Chip
      size="small"
      variant="outlined"
      icon={<EditNoteOutlined />}
      label="Draft"
      sx={{ cursor: 'inherit' }}
    />
  );
}
