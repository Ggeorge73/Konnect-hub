'use client';
import { useState } from 'react';
import { Avatar, Box, ButtonBase, Divider, ListSubheader, Menu, MenuItem, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMe, usePeople, api } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { initials } from '@/components/ui/bits';

/**
 * Bottom-of-nav user/org block. In demo mode it doubles as a persona switcher. With Supabase
 * Auth (`auth: 'supabase'` from /api/session) it only offers "Sign out", a POST to /auth/sign-out.
 */
export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { data: me } = useMe();
  const demo = me?.auth !== 'supabase';
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
        aria-label={
          demo
            ? `Signed in as ${me.user.name}. Switch demo user`
            : `Signed in as ${me.user.name}. Account menu`
        }
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
        {demo
          ? [
              <ListSubheader key="h">Demo mode — view as</ListSubheader>,
              ...people.map((p) => (
                <MenuItem key={p.id} selected={p.id === me.user.id} onClick={() => switchTo(p.id)}>
                  <Box>
                    <Typography fontSize={14}>{p.name}</Typography>
                    <Typography fontSize={11} color="text.secondary">
                      {ROLE_LABEL[p.role]}
                    </Typography>
                  </Box>
                </MenuItem>
              )),
              <Divider key="d" />,
              <MenuItem key="so" disabled>
                Sign out (Supabase mode)
              </MenuItem>,
            ]
          : [
              <ListSubheader key="h">{me.user.email}</ListSubheader>,
              // A real form POST: the route signs out and redirects (303) to /auth/sign-in.
              <MenuItem
                key="so"
                component="button"
                type="submit"
                form="kh-sign-out"
                onClick={() => qc.clear()}
                sx={{ width: '100%', gap: 1 }}
              >
                <LogoutIcon fontSize="small" aria-hidden />
                Sign out
              </MenuItem>,
            ]}
      </Menu>
      {!demo && <form id="kh-sign-out" method="post" action="/auth/sign-out" hidden />}
    </>
  );
}
