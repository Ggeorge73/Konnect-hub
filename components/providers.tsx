'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CssBaseline, ThemeProvider, type PaletteMode } from '@mui/material';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createKonnectorTheme } from '@/lib/theme';

const ModeCtx = createContext<{ mode: PaletteMode; toggle: () => void }>({ mode: 'dark', toggle: () => {} });
export const useColorMode = () => useContext(ModeCtx);

export function Providers({
  children,
  defaultMode = 'dark',
}: {
  children: React.ReactNode;
  defaultMode?: PaletteMode;
}) {
  const [mode, setMode] = useState<PaletteMode>(defaultMode);
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
      }),
  );
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kh_mode') as PaletteMode | null;
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const theme = useMemo(() => createKonnectorTheme(mode), [mode]);
  const ctx = useMemo(
    () => ({
      mode,
      toggle: () =>
        setMode((m) => {
          const next = m === 'dark' ? 'light' : 'dark';
          try {
            localStorage.setItem('kh_mode', next);
          } catch {
            /* ignore */
          }
          return next;
        }),
    }),
    [mode],
  );
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ModeCtx.Provider value={ctx}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <QueryClientProvider client={qc}>{children}</QueryClientProvider>
        </ThemeProvider>
      </ModeCtx.Provider>
    </AppRouterCacheProvider>
  );
}
