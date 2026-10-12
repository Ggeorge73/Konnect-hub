'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppBar,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  Drawer,
} from '@mui/material';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import AssignmentIndOutlined from '@mui/icons-material/AssignmentIndOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import TimelineOutlined from '@mui/icons-material/TimelineOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutline';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import Search from '@mui/icons-material/Search';
import Add from '@mui/icons-material/Add';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import Menu from '@mui/icons-material/Menu';
import { APP_NAME } from '@/lib/config';
import { useColorMode } from '@/components/providers';
import { useMe, useProjects } from '@/lib/client/api';
import { useHotkeys } from './useHotkeys';
import { SearchDialog } from './SearchDialog';
import { QuickCreate } from './QuickCreate';
import { UserMenu } from './UserMenu';

const NAV_W = 248;
const NAV_W_COLLAPSED = 76;

function useProjectKey() {
  const path = usePathname();
  return path.match(/^\/projects\/([A-Z0-9]+)/)?.[1];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { mode, toggle } = useColorMode();
  const projectKey = useProjectKey();
  const { data: me } = useMe();
  const isAdmin = me?.user.role === 'admin';

  const hotkeys = useMemo(() => ({ '/': () => setSearchOpen(true), c: () => setCreateOpen(true) }), []);
  useHotkeys(hotkeys);

  const nav = (
    <SideNav
      collapsed={!mobile && collapsed}
      projectKey={projectKey}
      isAdmin={isAdmin}
      onToggle={() => setCollapsed((c) => !c)}
      mobile={mobile}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
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
      {mobile ? (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          slotProps={{ paper: { sx: { width: NAV_W, p: 1.5 } } }}
        >
          {nav}
        </Drawer>
      ) : (
        <Box
          component="nav"
          aria-label="Main"
          sx={{
            width: collapsed ? NAV_W_COLLAPSED : NAV_W,
            flexShrink: 0,
            p: 1.5,
            transition: 'width 180ms ease-out',
          }}
        >
          <Paper
            sx={{
              position: 'sticky',
              top: 12,
              height: 'calc(100vh - 24px)',
              borderRadius: 4,
              p: 1.5,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {nav}
          </Paper>
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          elevation={0}
          color="transparent"
          sx={{ backdropFilter: 'blur(12px)', borderBottom: 1, borderColor: 'divider' }}
        >
          <Toolbar sx={{ gap: 1 }}>
            {mobile && (
              <IconButton aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
                <Menu />
              </IconButton>
            )}
            <Crumbs />
            <Box sx={{ flex: 1 }} />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<Search />}
              onClick={() => setSearchOpen(true)}
              sx={{
                borderColor: 'divider',
                color: 'text.secondary',
                minWidth: { xs: 0, sm: 220 },
                justifyContent: 'flex-start',
              }}
              aria-label="Search (press /)"
            >
              <Box
                component="span"
                sx={{ display: { xs: 'none', sm: 'inline' }, flex: 1, textAlign: 'left' }}
              >
                Search
              </Box>
              <Box
                component="kbd"
                sx={{
                  display: { xs: 'none', sm: 'inline' },
                  fontSize: 11,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 0.6,
                }}
              >
                /
              </Box>
            </Button>
            <Tooltip title="Create (c)">
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => setCreateOpen(true)}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                Create
              </Button>
            </Tooltip>
            <Tooltip title="Notifications">
              <IconButton aria-label="Notifications">
                <Badge color="primary" variant="dot" invisible>
                  <NotificationsNoneOutlined />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === 'dark' ? 'Light theme' : 'Dark theme'}>
              <IconButton aria-label="Toggle colour theme" onClick={toggle}>
                {mode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
        <Box component="main" id="main" sx={{ p: { xs: 2, md: 3 }, flex: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <QuickCreate open={createOpen} onClose={() => setCreateOpen(false)} projectKey={projectKey} />
    </Box>
  );
}

function SideNav({
  collapsed,
  projectKey,
  isAdmin,
  onToggle,
  mobile,
  onNavigate,
}: {
  collapsed: boolean;
  projectKey?: string;
  isAdmin: boolean;
  onToggle: () => void;
  mobile: boolean;
  onNavigate: () => void;
}) {
  const path = usePathname();
  const router = useRouter();
  const { data: projects = [] } = useProjects();
  const pk = projectKey ?? projects[0]?.key;
  const items = [
    { label: 'Portfolio', href: '/', icon: DashboardOutlined },
    { label: 'My Work', href: '/my-work', icon: AssignmentIndOutlined },
    { label: 'Projects', href: '/projects', icon: FolderOutlined },
    { label: 'Boards', href: pk ? `/projects/${pk}/board` : '/projects', icon: ViewKanbanOutlined },
    { label: 'Timeline', href: pk ? `/projects/${pk}/timeline` : '/projects', icon: TimelineOutlined },
    { label: 'RAID', href: pk ? `/projects/${pk}/raid` : '/projects', icon: ReportProblemOutlined },
    { label: 'Dashboards', href: '/dashboards', icon: InsightsOutlined },
    { label: 'People', href: '/people', icon: PeopleOutline },
    { label: 'Reports', href: '/reports', icon: DescriptionOutlined },
    ...(isAdmin ? [{ label: 'Admin', href: '/admin', icon: AdminPanelSettingsOutlined }] : []),
  ];
  const isActive = (href: string) =>
    href === '/'
      ? path === '/'
      : path === href ||
        (href.length > 1 && path.startsWith(href.split('?')[0]) && href !== '/projects') ||
        (href === '/projects' && path === '/projects');
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5, mb: 1.5, minHeight: 40 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 2,
            bgcolor: 'primary.main',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            color: 'primary.contrastText',
            flexShrink: 0,
          }}
          aria-hidden
        >
          K
        </Box>
        {!collapsed && (
          <Typography fontWeight={700} noWrap>
            {APP_NAME}
          </Typography>
        )}
        {!mobile && (
          <IconButton
            size="small"
            onClick={onToggle}
            sx={{ ml: 'auto' }}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? <ChevronRight fontSize="small" /> : <ChevronLeft fontSize="small" />}
          </IconButton>
        )}
      </Box>
      {!collapsed && projects.length > 0 && (
        <TextField
          select
          size="small"
          label="Project"
          value={projectKey ?? ''}
          onChange={(e) => {
            router.push(`/projects/${e.target.value}`);
            onNavigate();
          }}
          sx={{ mb: 1.5 }}
        >
          {projects.map((p) => (
            <MenuItem key={p.id} value={p.key}>
              {p.key} · {p.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      <List dense sx={{ flex: 1, overflow: 'auto' }}>
        {items.map(({ label, href, icon: Icon }) => {
          const btn = (
            <ListItemButton
              component={Link}
              href={href}
              selected={isActive(href)}
              onClick={onNavigate}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                width: '100%',
                '&.Mui-selected': { bgcolor: 'rgba(20,184,166,0.16)' },
              }}
              aria-label={collapsed ? label : undefined}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              {!collapsed && <ListItemText primary={label} />}
            </ListItemButton>
          );
          return (
            <ListItem key={label} disablePadding>
              {collapsed ? (
                <Tooltip title={label} placement="right">
                  {btn}
                </Tooltip>
              ) : (
                btn
              )}
            </ListItem>
          );
        })}
      </List>
      <Divider sx={{ my: 1 }} />
      <UserMenu collapsed={collapsed} />
    </>
  );
}

const SEGMENT_LABEL: Record<string, string> = {
  projects: 'Projects',
  board: 'Board',
  list: 'List',
  timeline: 'Timeline',
  raid: 'RAID',
  search: 'Search',
  'my-work': 'My Work',
  dashboards: 'Dashboards',
  people: 'People',
  reports: 'Reports',
  admin: 'Admin',
  new: 'New',
};

function Crumbs() {
  const path = usePathname();
  const parts = path.split('/').filter(Boolean);
  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ display: { xs: 'none', md: 'flex' } }}>
      <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
        Portfolio
      </Link>
      {parts.map((p, i) => {
        const href = '/' + parts.slice(0, i + 1).join('/');
        const label = SEGMENT_LABEL[p] ?? p;
        return i === parts.length - 1 ? (
          <Typography key={href} color="text.primary" fontSize={14}>
            {label}
          </Typography>
        ) : (
          <Link key={href} href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
            {label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
