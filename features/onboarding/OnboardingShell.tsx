'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import {
  Box,
  Button,
  Container,
  CssBaseline,
  IconButton,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import { APP_NAME } from '@/lib/config';
import { useColorMode } from '@/components/providers';
import { createAccessibleTheme } from '@/features/portal/theme';

/** Minimal frame for the setup wizard. Follows the app's theme toggle, with AA-safe light accents. */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const { mode, toggle } = useColorMode();
  const theme = useMemo(() => createAccessibleTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
        <Box
          component="header"
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 3 }, py: 1.5 }}
        >
          <Box
            aria-hidden
            sx={{
              width: 30,
              height: 30,
              borderRadius: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
            }}
          >
            K
          </Box>
          <Typography fontWeight={700} sx={{ flex: 1 }}>
            {APP_NAME} setup
          </Typography>
          <Tooltip title={mode === 'dark' ? 'Light theme' : 'Dark theme'}>
            <IconButton aria-label="Toggle colour theme" onClick={toggle}>
              {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
            </IconButton>
          </Tooltip>
          <Button component={Link} href="/" color="inherit">
            Exit setup
          </Button>
        </Box>
        <Container
          maxWidth="md"
          component="main"
          id="main"
          sx={{ py: { xs: 2, sm: 4 }, px: { xs: 2, sm: 3 } }}
        >
          {children}
        </Container>
      </Box>
    </ThemeProvider>
  );
}
