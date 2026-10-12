'use client';
import { Chip, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import GppGoodOutlined from '@mui/icons-material/GppGoodOutlined';
import { LOAD_LABEL, type LoadLevel } from '@/lib/domain/capacity';
import { RAG_COLORS } from '@/lib/theme';

export const LOAD_COLOR: Record<LoadLevel, string> = {
  ok: RAG_COLORS.green,
  amber: RAG_COLORS.amber,
  red: RAG_COLORS.red,
};
export const LOAD_ICON = { ok: CheckCircleOutline, amber: WarningAmber, red: ErrorOutline };

/** Load is always colour + icon + % text. */
export function LoadChip({ pct, level }: { pct: number; level: LoadLevel }) {
  const Icon = LOAD_ICON[level];
  return (
    <Chip
      size="small"
      icon={<Icon sx={{ color: `${LOAD_COLOR[level]} !important`, fontSize: 16 }} />}
      label={`${pct}%`}
      aria-label={`${pct}% of capacity, ${LOAD_LABEL[level]}`}
      variant="outlined"
      sx={{ borderColor: LOAD_COLOR[level], fontWeight: 600, fontFamily: 'inherit' }}
    />
  );
}

/** The Restricted (U.S. persons only) chip shown on the project header and Team tab. */
export function RestrictedChip() {
  return (
    <Tooltip title="Export-controlled: only U.S. persons can be assigned">
      <Chip
        size="small"
        icon={<GppGoodOutlined sx={{ fontSize: 16 }} />}
        label="Restricted · U.S. persons only"
        sx={{
          fontWeight: 600,
          bgcolor: (t) => alpha(t.palette.error.main, 0.12),
          color: 'text.primary',
          border: (t) => `1px solid ${t.palette.error.main}`,
        }}
      />
    </Tooltip>
  );
}
