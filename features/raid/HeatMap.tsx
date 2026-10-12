'use client';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { BAND_LABEL, scoreBand } from '@/lib/domain/raid';
import { MONO, RAG_COLORS } from '@/lib/theme';
import { BAND_TEXT } from './RaidChips';

export type Cell = { p: number; i: number };

/**
 * Interactive 5×5 risk heat map: impact on X (1→5), probability on Y (5 at the top).
 * Every cell is a focusable button showing the count and the P×I score; clicking toggles a filter.
 */
export function HeatMap({
  heat,
  selected,
  onSelect,
}: {
  heat: number[][];
  selected: Cell | null;
  onSelect: (c: Cell | null) => void;
}) {
  const levels = [1, 2, 3, 4, 5];
  return (
    <Box>
      <Box
        role="group"
        aria-label="Risk heat map: probability by impact"
        sx={{
          display: 'grid',
          gridTemplateColumns: '28px repeat(5, minmax(44px, 1fr))',
          gridTemplateRows: 'repeat(5, minmax(48px, auto)) 28px',
          gap: 0.75,
        }}
      >
        {[...levels].reverse().map((p) => (
          <Box key={`row-${p}`} sx={{ display: 'contents' }}>
            <Typography
              aria-hidden
              sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary', alignSelf: 'center' }}
            >
              P{p}
            </Typography>
            {levels.map((i) => {
              const score = p * i;
              const band = scoreBand(score);
              const count = heat[p - 1][i - 1];
              const active = selected?.p === p && selected?.i === i;
              return (
                <ButtonBase
                  key={`${p}-${i}`}
                  focusRipple
                  aria-pressed={active}
                  aria-label={`Probability ${p}, impact ${i}: score ${score} (${BAND_LABEL[band]}), ${count} open ${count === 1 ? 'risk' : 'risks'}`}
                  onClick={() => onSelect(active ? null : { p, i })}
                  sx={{
                    bgcolor: RAG_COLORS[band],
                    color: BAND_TEXT,
                    borderRadius: 2,
                    flexDirection: 'column',
                    py: 0.5,
                    outline: active ? '3px solid' : 'none',
                    outlineColor: 'text.primary',
                    outlineOffset: 2,
                    boxShadow: count ? 'inset 0 0 0 2px rgba(15,23,42,0.55)' : 'none',
                  }}
                >
                  <Box component="span" sx={{ fontSize: 18, fontWeight: count ? 800 : 500, lineHeight: 1.1 }}>
                    {count}
                  </Box>
                  <Box component="span" sx={{ fontFamily: MONO, fontSize: 10, fontWeight: 600 }}>
                    {score}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>
        ))}
        <Box />
        {levels.map((i) => (
          <Typography
            key={`col-${i}`}
            aria-hidden
            sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary', textAlign: 'center' }}
          >
            I{i}
          </Typography>
        ))}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5, pl: '34px' }}>
        <Typography variant="caption" color="text.secondary">
          Impact →
        </Typography>
        <Typography variant="caption" color="text.secondary">
          ↑ Probability
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {(
          [
            ['green', '1–4 Low'],
            ['amber', '5–12 Medium'],
            ['red', '15–25 High'],
          ] as const
        ).map(([b, text]) => (
          <Stack key={b} direction="row" spacing={0.5} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: RAG_COLORS[b] }} aria-hidden />
            <Typography variant="caption">{text}</Typography>
          </Stack>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        Each cell shows the number of open risks and the P×I score. Select a cell to filter the list.
      </Typography>
    </Box>
  );
}
