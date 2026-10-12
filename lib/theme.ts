'use client';
import { alpha, createTheme, type PaletteMode } from '@mui/material/styles';

export const tokens = {
  dark: {
    bg: 'linear-gradient(160deg, #060B1F 0%, #0B1F3A 100%)',
    bgSolid: '#081329',
    glass: 'rgba(17, 28, 68, 0.72)',
    border: 'rgba(255,255,255,0.08)',
    primary: '#14B8A6',
    secondary: '#3B82F6',
    text: '#F8FAFC',
    muted: '#A0AEC0',
  },
  light: {
    bg: '#F5F7FA',
    bgSolid: '#F5F7FA',
    glass: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#0F9488',
    secondary: '#2563EB',
    text: '#0F172A',
    muted: '#475569',
  },
};

export const RAG_COLORS = { green: '#22C55E', amber: '#F59E0B', red: '#EF4444' } as const;
export const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export function createKonnectorTheme(mode: PaletteMode) {
  const t = tokens[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: t.primary, contrastText: mode === 'dark' ? '#04201D' : '#FFFFFF' },
      secondary: { main: t.secondary },
      success: { main: RAG_COLORS.green },
      warning: { main: RAG_COLORS.amber },
      error: { main: RAG_COLORS.red },
      background: { default: t.bgSolid, paper: t.glass },
      text: { primary: t.text, secondary: t.muted },
      divider: t.border,
    },
    shape: { borderRadius: 4 }, // sx radius units: 2 = 8px chips, 3 = 12px inputs, 4 = 16px cards
    typography: {
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h1: { fontSize: '1.75rem', fontWeight: 700 },
      h2: { fontSize: '1.375rem', fontWeight: 700 },
      h3: { fontSize: '1.125rem', fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    transitions: { duration: { shortest: 150, shorter: 175, short: 200, standard: 200 } },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { background: t.bg, backgroundAttachment: 'fixed', minHeight: '100vh' },
          '*:focus-visible': { outline: `2px solid ${t.secondary}`, outlineOffset: 2 },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': { transition: 'none !important', animation: 'none !important' },
          },
          '@media print': { body: { background: '#fff', color: '#000' } },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: t.glass,
            border: `1px solid ${t.border}`,
            ...(mode === 'dark' ? { backdropFilter: 'blur(18px)' } : {}),
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            transition: 'box-shadow 180ms ease-out, transform 180ms ease-out',
            '&:hover': { boxShadow: `inset 0 0 24px ${alpha(t.primary, 0.12)}` },
          },
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiAvatar: { styleOverrides: { root: { backgroundColor: '#0F766E', color: '#FFFFFF' } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiDrawer: { styleOverrides: { paper: { borderRadius: 0 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiButtonBase: { defaultProps: { disableRipple: false } },
    },
  });
}
