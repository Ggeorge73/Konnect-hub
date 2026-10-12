'use client';
import { useEffect } from 'react';
import { AppBar, Box, Container, Toolbar, Typography } from '@mui/material';
import { APP_NAME } from '@/lib/config';
import { useColorMode } from '@/components/providers';
import { UserMenu } from '@/components/shell/UserMenu';
import { NotificationsBell } from '@/components/shell/NotificationsBell';

/** Client portal: same app, scoped experience, light theme by default. */
export function PortalShell({
  children,
  orgName,
}: {
  children: React.ReactNode;
  orgName: string;
  userName: string;
}) {
  const { mode, toggle } = useColorMode();
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('kh_mode');
    } catch {
      /* ignore */
    }
    if (!saved && mode === 'dark') toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar
        position="sticky"
        color="transparent"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', backdropFilter: 'blur(12px)' }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Box
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
            aria-hidden
          >
            K
          </Box>
          <Typography fontWeight={700}>{APP_NAME}</Typography>
          <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            · {orgName} portal
          </Typography>
          <Box sx={{ flex: 1 }} />
          <NotificationsBell />
          <Box sx={{ width: { xs: 'auto', sm: 240 }, minWidth: 0 }}>
            <UserMenu collapsed={false} />
          </Box>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }} component="main" id="main">
        {children}
      </Container>
    </Box>
  );
}
