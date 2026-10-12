'use client';
import { Chip } from '@mui/material';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import TimerOffOutlined from '@mui/icons-material/TimerOffOutlined';
import HourglassBottomOutlined from '@mui/icons-material/HourglassBottomOutlined';
import { BAND_LABEL, scoreBand, SEVERITIES, type IssueSeverity } from '@/lib/domain/raid';
import { MONO, RAG_COLORS } from '@/lib/theme';

/** Dark text on band colours keeps AA contrast on all three. */
export const BAND_TEXT = '#0F172A';

/** Score is colour + number + word, never colour alone. */
export function ScoreChip({ score, label }: { score: number | null; label?: string }) {
  if (score === null) return <>—</>;
  const band = scoreBand(score);
  return (
    <Chip
      size="small"
      label={`${label ? label + ' ' : ''}${score} · ${BAND_LABEL[band]}`}
      sx={{ bgcolor: RAG_COLORS[band], color: BAND_TEXT, fontWeight: 700, fontFamily: MONO, fontSize: 12 }}
    />
  );
}

/** Outlined chips use a coloured border and icon with default text colour, like RagChip. */
function FlagChip({ label, color, icon }: { label: string; color: string; icon: React.ReactElement }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={icon}
      label={label}
      sx={{ borderColor: color, fontWeight: 600, '& .MuiChip-icon': { color } }}
    />
  );
}

export const EscalateChip = () => (
  <FlagChip label="Escalate to steering" color={RAG_COLORS.red} icon={<FlagOutlined />} />
);
export const SlaBreachedChip = () => (
  <FlagChip label="SLA breached" color={RAG_COLORS.red} icon={<TimerOffOutlined />} />
);
export const StaleChip = () => (
  <FlagChip label="Stale" color={RAG_COLORS.amber} icon={<HourglassBottomOutlined />} />
);

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  critical: RAG_COLORS.red,
  major: RAG_COLORS.amber,
  minor: '#94A3B8',
};

export function SeverityChip({ severity }: { severity: IssueSeverity | null | undefined }) {
  if (!severity) return <>—</>;
  return (
    <Chip
      size="small"
      variant="outlined"
      label={SEVERITIES.find((s) => s.id === severity)!.label}
      sx={{ borderColor: SEVERITY_COLOR[severity], borderWidth: 2, fontWeight: 600 }}
    />
  );
}
