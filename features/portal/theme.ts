'use client';
import { createTheme, type PaletteMode } from '@mui/material/styles';
import { createKonnectorTheme } from '@/lib/theme';

/**
 * Light-theme accents that pass WCAG AA (4.5:1) as text and with white labels on #FFFFFF and
 * #F5F7FA. The brand teal #0F9488 and RAG greens/ambers are only ~2.3–3.7:1 as text, which axe
 * flags on the client portal and onboarding (both light by default). Dark mode is unchanged; RAG
 * meaning still comes from icon + text, these are just darker shades of the same hues.
 */
export const AA_LIGHT = {
  primary: '#0F766E',
  success: '#15803D',
  warning: '#B45309',
  error: '#B91C1C',
  info: '#1D4ED8',
} as const;

export function createAccessibleTheme(mode: PaletteMode) {
  const base = createKonnectorTheme(mode);
  if (mode === 'dark') return base;
  const c = (main: string) => ({ main, contrastText: '#FFFFFF' });
  return createTheme(base, {
    palette: {
      primary: c(AA_LIGHT.primary),
      success: c(AA_LIGHT.success),
      warning: c(AA_LIGHT.warning),
      error: c(AA_LIGHT.error),
      info: c(AA_LIGHT.info),
    },
  });
}
