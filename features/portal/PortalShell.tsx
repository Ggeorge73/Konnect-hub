'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AppBar,
  Badge,
  Box,
  Container,
  CssBaseline,
  IconButton,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  type PaletteMode,
} from '@mui/material';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import { APP_NAME } from '@/lib/config';
import { initials } from '@/components/ui/bits';
import { UserMenu } from '@/components/shell/UserMenu';
import { NotificationsBell } from '@/components/shell/NotificationsBell';
import type { InboxEntry } from '@/lib/domain/portal';
import type { PortalBranding } from '@/lib/data/portal';
import type { Impersonation } from '@/lib/domain/types';
import { PreviewBanner } from '@/features/admin/PreviewBanner';
import { useInbox } from './api';
import { createKonnectorTheme } from '@/lib/theme';

/** The portal keeps its own theme choice (light by default) so it never flips the internal app. */
export const PORTAL_MODE_KEY = 'kh_portal_mode';

function usePortalMode() {
  const [mode, setMode] = useState<PaletteMode>('light');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PORTAL_MODE_KEY);
      if (saved === 'dark' || saved === 'light') setMode(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () =>
    setMode((m) => {
      const next = m === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(PORTAL_MODE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  return { mode, toggle };
}

function Logo({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  if (src)
    return (
      <Box
        component="img"
        src={src}
        alt={`${name} logo`}
        sx={{ width: size, height: size, borderRadius: 2, objectFit: 'contain', flexShrink: 0 }}
      />
    );
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </Box>
  );
}

/** Client portal: same app, scoped experience, Konnector mark plus the client's logo, light theme by default. */
export function PortalShell({
  children,
  orgName,
  branding,
  inbox,
  preview,
}: {
  children: React.ReactNode;
  orgName: string;
  userName: string;
  branding?: PortalBranding;
  inbox?: InboxEntry[];
  /** KH-47: an Admin's read-only "View as client" preview. */
  preview?: Impersonation;
}) {
  const { mode, toggle } = usePortalMode();
  const theme = useMemo(() => createKonnectorTheme(mode), [mode]);
  const workspaceName = branding?.workspaceName ?? APP_NAME;
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
        <Box
          component="a"
          href="#main"
          sx={{
            position: 'absolute',
            left: -9999,
            '&:focus': { left: 8, top: 8, zIndex: 9999, bgcolor: 'background.paper', p: 1 },
          }}
        >
          Skip to content
        </Box>
        {preview && <PreviewBanner preview={preview} />}
        <AppBar
          position="sticky"
          color="transparent"
          elevation={0}
          sx={{ borderBottom: 1, borderColor: 'divider', backdropFilter: 'blur(12px)' }}
        >
          <Toolbar sx={{ gap: { xs: 1, sm: 1.5 }, px: { xs: 1.5, sm: 3 } }}>
            <Box
              component={Link}
              href="/portal"
              aria-label={`${workspaceName} client portal home`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none' }}
            >
              {branding?.workspaceLogoUrl ? (
                <Logo src={branding.workspaceLogoUrl} name={workspaceName} size={30} />
              ) : (
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
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  K
                </Box>
              )}
              <Typography fontWeight={700} noWrap sx={{ display: { xs: 'none', md: 'block' } }}>
                {workspaceName}
              </Typography>
            </Box>
            <Box
              aria-hidden
              sx={{ width: '1px', alignSelf: 'stretch', my: 1.5, bgcolor: 'divider', flexShrink: 0 }}
            />
            <Logo src={branding?.orgLogoUrl ?? null} name={orgName} />
            <Typography
              color="text.secondary"
              noWrap
              sx={{ display: { xs: 'none', sm: 'block' }, minWidth: 0 }}
            >
              {orgName} portal
            </Typography>
            <Box sx={{ flex: 1 }} />
            <InboxBadge initial={inbox ?? []} />
            <NotificationsBell />
            <Tooltip title={mode === 'dark' ? 'Light theme' : 'Dark theme'}>
              <IconButton aria-label="Toggle colour theme" onClick={toggle}>
                {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
              </IconButton>
            </Tooltip>
            <Box sx={{ width: { xs: 'auto', sm: 220 }, minWidth: 0 }}>
              <UserMenu collapsed={false} />
            </Box>
          </Toolbar>
        </AppBar>
        <Container maxWidth="lg" sx={{ py: 3, px: { xs: 2, sm: 3 } }} component="main" id="main">
          {children}
        </Container>
      </Box>
    </ThemeProvider>
  );
}

/** Header count of what is waiting on the client; links to the inbox on the portal home. */
function InboxBadge({ initial }: { initial: InboxEntry[] }) {
  const { data = initial } = useInbox(initial);
  const n = data.length;
  return (
    <Tooltip title="Needs your approval">
      <IconButton
        component={Link}
        href="/portal#inbox"
        aria-label={`Needs your approval: ${n} ${n === 1 ? 'item' : 'items'}`}
        data-testid="portal-inbox-badge"
      >
        <Badge badgeContent={n} color="error" max={99}>
          <TaskAltOutlined />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
