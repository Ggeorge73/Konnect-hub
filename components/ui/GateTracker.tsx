'use client';
import { Box, Stack, Tooltip, Typography } from '@mui/material';
import Check from '@mui/icons-material/Check';
import type { Phase } from '@/lib/domain/types';

const PASSED = new Set(['approved', 'approved_with_conditions']);
const STATUS_TEXT: Record<Phase['status'], string> = {
  not_started: 'Not started',
  active: 'Active',
  ready_for_review: 'Ready for gate review',
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  rejected: 'Rejected',
};

/** The product's visual signature: five connected gate nodes, current one glowing teal. */
export function GateTracker({ phases, compact = false }: { phases: Phase[]; compact?: boolean }) {
  const current = phases.find((p) => !PASSED.has(p.status));
  return (
    <Box
      component="ol"
      aria-label="Delivery gates"
      sx={{ display: 'flex', alignItems: 'center', p: 0, m: 0, listStyle: 'none', width: '100%' }}
    >
      {phases.map((p, i) => {
        const passed = PASSED.has(p.status);
        const isCurrent = current?.id === p.id;
        const size = compact ? 22 : 34;
        return (
          <Box
            component="li"
            key={p.id}
            sx={{ display: 'flex', alignItems: 'center', flex: i < phases.length - 1 ? 1 : '0 0 auto' }}
          >
            <Tooltip title={`Gate ${p.gate} · ${p.name}: ${STATUS_TEXT[p.status]}`}>
              <Stack alignItems="center" spacing={0.5} aria-current={isCurrent ? 'step' : undefined}>
                <Box
                  sx={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: compact ? 11 : 14,
                    border: '2px solid',
                    borderColor: passed || isCurrent ? 'primary.main' : 'divider',
                    bgcolor: passed ? 'primary.main' : 'transparent',
                    color: passed ? 'primary.contrastText' : isCurrent ? 'primary.main' : 'text.secondary',
                    boxShadow: isCurrent
                      ? '0 0 0 4px rgba(20,184,166,0.18), 0 0 18px rgba(20,184,166,0.55)'
                      : 'none',
                    transition: 'box-shadow 200ms ease-out',
                  }}
                >
                  {passed ? <Check sx={{ fontSize: compact ? 14 : 18 }} /> : p.gate}
                </Box>
                {!compact && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {p.name}
                    <Box
                      component="span"
                      sx={{
                        position: 'absolute',
                        width: 1,
                        height: 1,
                        overflow: 'hidden',
                        clip: 'rect(0 0 0 0)',
                      }}
                    >
                      {` — ${STATUS_TEXT[p.status]}`}
                    </Box>
                  </Typography>
                )}
              </Stack>
            </Tooltip>
            {i < phases.length - 1 && (
              <Box
                aria-hidden
                sx={{
                  flex: 1,
                  height: 2,
                  mx: 1,
                  mb: compact ? 0 : 2.5,
                  bgcolor: passed ? 'primary.main' : 'divider',
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
