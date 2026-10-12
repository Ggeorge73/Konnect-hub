'use client';
import { useTheme } from '@mui/material/styles';
import { MONO } from '@/lib/theme';

/**
 * Colour-blind-safe categorical slots (fixed order, never cycled), stepped per mode and validated
 * for CVD separation against the glass surface of each theme. Light-mode slots 3–5 sit under 3:1
 * on white, so every chart also ships a data table (the "relief" rule).
 */
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
} as const;

/** Chart styling from the active MUI theme: text tokens for ink, divider for grid, series slots. */
export function useChartTheme() {
  const t = useTheme();
  const mode = t.palette.mode;
  return {
    series: SERIES[mode],
    text: t.palette.text.primary,
    muted: t.palette.text.secondary,
    grid: t.palette.divider,
    surface: mode === 'dark' ? '#111C44' : '#FFFFFF',
    axis: { fontSize: 12, fontFamily: MONO, fill: t.palette.text.secondary },
    tooltip: {
      contentStyle: {
        background: mode === 'dark' ? '#0B1530' : '#FFFFFF',
        border: `1px solid ${t.palette.divider}`,
        borderRadius: 12,
        color: t.palette.text.primary,
        fontSize: 13,
      },
      labelStyle: { color: t.palette.text.primary, fontWeight: 600 },
      itemStyle: { color: t.palette.text.primary },
    },
  };
}
