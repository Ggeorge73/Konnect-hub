'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Paper, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import DoneAll from '@mui/icons-material/DoneAll';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { EmptyState } from '@/components/ui/bits';
import { useMarkRead, useNotifications } from './api';
import { NotificationList } from './NotificationList';

/** Full notification center (/notifications): All / Unread, mark all read, works at phone width. */
export function NotificationsPage() {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkRead();
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const all = data ?? [];
  const unread = all.filter((n) => !n.readAt);
  const shown = tab === 'unread' ? unread : all;
  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto', width: '100%' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        useFlexGap
      >
        <Typography variant="h1" sx={{ flex: 1 }}>
          Notifications
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<DoneAll />}
            disabled={!unread.length || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
          <Button component={Link} href="/settings/notifications" startIcon={<SettingsOutlined />}>
            Settings
          </Button>
        </Stack>
      </Stack>
      <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          aria-label="Filter notifications"
          sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="all" label={`All (${all.length})`} />
          <Tab value="unread" label={`Unread (${unread.length})`} />
        </Tabs>
        {isLoading ? (
          <Stack sx={{ p: 2 }} spacing={1}>
            <Skeleton height={48} />
            <Skeleton height={48} />
          </Stack>
        ) : all.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            body="Mentions, assignments, approvals and updates on items you watch will show up here."
            action={
              <Button component={Link} href="/settings/notifications" variant="contained">
                Choose what you hear about
              </Button>
            }
          />
        ) : (
          <NotificationList
            items={shown}
            emptyText="No unread notifications. You're all caught up."
            onOpen={(n) => {
              if (!n.readAt) markRead.mutate([n.id]);
              router.push(n.href);
            }}
          />
        )}
      </Paper>
    </Stack>
  );
}
