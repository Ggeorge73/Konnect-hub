'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Box, Button, Divider, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { useMarkRead, useNotifications } from '@/features/notifications/api';
import { NotificationList } from '@/features/notifications/NotificationList';

/** Top-bar bell: unread badge and an inbox popover (newest 10), with the full list at /notifications. */
export function NotificationsBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data = [] } = useNotifications();
  const markRead = useMarkRead();
  const router = useRouter();
  const unread = data.filter((n) => !n.readAt).length;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  const close = () => setAnchor(null);
  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
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
      <Popover
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': 'Notifications',
            sx: { width: 380, maxWidth: 'calc(100vw - 16px)', maxHeight: '75vh', borderRadius: 3 },
          } as object,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
          <Typography fontWeight={700} sx={{ flex: 1 }}>
            Notifications
          </Typography>
          {unread > 0 && (
            <Button size="small" onClick={() => markRead.mutate(undefined)}>
              Mark all read
            </Button>
          )}
          <Tooltip title="Notification settings">
            <IconButton
              size="small"
              aria-label="Notification settings"
              component={Link}
              href="/settings/notifications"
              onClick={close}
            >
              <SettingsOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Divider />
        <Box sx={{ overflow: 'auto', maxHeight: 'calc(75vh - 110px)' }}>
          <NotificationList
            items={data.slice(0, 10)}
            onOpen={(n) => {
              if (!n.readAt) markRead.mutate([n.id]);
              close();
              router.push(n.href);
            }}
          />
        </Box>
        <Divider />
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Button component={Link} href="/notifications" onClick={close} fullWidth>
            View all notifications
          </Button>
        </Box>
      </Popover>
    </>
  );
}
