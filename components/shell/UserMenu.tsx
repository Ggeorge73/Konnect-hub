'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Avatar, Box, ButtonBase, Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMe, usePeople, api } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { initials } from '@/components/ui/bits';

/** Bottom-of-nav user/org block. In demo mode it doubles as a persona switcher. */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: me } = useMe();
  const { data: people = [] } = usePeople();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const qc = useQueryClient();
  const router = useRouter();
  if (!me) return null;
  const switchTo = async (userId: string) => {
    await api('/api/session', { method: 'POST', body: JSON.stringify({ userId }) });
    setAnchor(null);
    qc.clear();
    router.push(
      ['client_sponsor', 'client_member', 'client_viewer'].includes(
        people.find((p) => p.id === userId)?.role ?? '',
      )
        ? '/portal'
        : '/',
    );
    router.refresh();
  };
  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={`Signed in as ${me.user.name}. Switch demo user`}
        sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, p: 1, borderRadius: 2 }}
      >
        <Avatar sx={{ width: 32, height: 32, fontSize: 13 }}>{initials(me.user.name)}</Avatar>
        {!collapsed && (
          <Box sx={{ textAlign: 'left', minWidth: 0 }}>
            <Typography noWrap fontSize={13} fontWeight={600}>
              {me.user.name}
            </Typography>
            <Typography noWrap fontSize={11} color="text.secondary">
              {ROLE_LABEL[me.user.role]} · {me.org.name}
            </Typography>
          </Box>
        )}
      </ButtonBase>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem component={Link} href="/settings/notifications" onClick={() => setAnchor(null)}>
          Notification settings
        </MenuItem>
        <Divider />
        <ListSubheader>Demo mode — view as</ListSubheader>
        {people.map((p) => (
          <MenuItem key={p.id} selected={p.id === me.user.id} onClick={() => switchTo(p.id)}>
            <Box>
              <Typography fontSize={14}>{p.name}</Typography>
              <Typography fontSize={11} color="text.secondary">
                {ROLE_LABEL[p.role]}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem disabled>Sign out (Supabase mode)</MenuItem>
      </Menu>
    </>
  );
}
