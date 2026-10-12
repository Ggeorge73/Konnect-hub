'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  Divider,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import { useMarkRead, useNotifications } from '@/features/raid/api';

/** Top-bar bell: unread badge and a simple list of in-app notifications. */
export function NotificationsBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data = [] } = useNotifications();
  const markRead = useMarkRead();
  const router = useRouter();
  const unread = data.filter((n) => !n.readAt).length;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          <Badge
            badgeContent={unread}
            max={99}
            sx={{ '& .MuiBadge-badge': { bgcolor: '#B91C1C', color: '#FFFFFF', fontWeight: 700 } }}
          >
            <NotificationsNoneOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 360, maxWidth: '100vw', borderRadius: 3 } } }}
      >
        <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={700} sx={{ flex: 1 }}>
            Notifications
          </Typography>
          {unread > 0 && (
            <Button size="small" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
        </Stack>
        <Divider />
        {data.length === 0 && (
          <MenuItem disabled>
            <ListItemText primary="You're all caught up." />
          </MenuItem>
        )}
        {data.slice(0, 15).map((n) => (
          <MenuItem
            key={n.id}
            onClick={() => {
              if (!n.readAt) markRead.mutate([n.id]);
              setAnchor(null);
              router.push(n.href);
            }}
            sx={{ whiteSpace: 'normal', alignItems: 'flex-start' }}
          >
            <ListItemText
              primary={n.title}
              secondary={new Date(n.createdAt).toLocaleString()}
              slotProps={{ primary: { fontWeight: n.readAt ? 400 : 700, fontSize: 14 } }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
