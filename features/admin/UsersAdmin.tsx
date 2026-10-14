'use client';
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import ForwardToInboxOutlined from '@mui/icons-material/ForwardToInboxOutlined';
import { useMe } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { rolesForOrg, type AdminUser } from '@/lib/domain/admin';
import type { Role } from '@/lib/domain/types';
import { EmptyState } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useAdminUsers, useResendUserInvite, useUpdateUser } from './api';

/** /admin/users (ADM-01): roles, deactivation and invite re-sends. Every change is audited. */
export function UsersAdmin() {
  const { data: users, error, isLoading } = useAdminUsers();
  const { data: me } = useMe();
  const update = useUpdateUser();
  const resend = useResendUserInvite();
  const [scope, setScope] = useState<'internal' | 'client'>('internal');
  const [q, setQ] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (users ?? []).filter(
      (u) =>
        u.orgType === scope &&
        (!t ||
          u.name.toLowerCase().includes(t) ||
          u.email.toLowerCase().includes(t) ||
          u.orgName.toLowerCase().includes(t)),
    );
  }, [users, scope, q]);

  const changeRole = (u: AdminUser, role: Role) =>
    update.mutate(
      { id: u.id, patch: { role } },
      { onSuccess: () => setNote(`${u.name} is now ${ROLE_LABEL[role]}. Recorded in the audit log.`) },
    );
  const setActive = (u: AdminUser, active: boolean) => {
    if (
      !active &&
      !window.confirm(`Deactivate ${u.name}? They can no longer sign in. You can reactivate them later.`)
    )
      return;
    update.mutate(
      { id: u.id, patch: { active } },
      { onSuccess: () => setNote(`${u.name} ${active ? 'reactivated' : 'deactivated'}.`) },
    );
  };

  return (
    <AdminPage
      title="Users"
      intro="Konnector staff and client users. Role changes and deactivations are audited."
    >
      <Paper sx={{ borderRadius: 4 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ p: 2 }}
          alignItems={{ sm: 'center' }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={scope}
            onChange={(_, v) => v && setScope(v)}
            aria-label="Which users"
          >
            <ToggleButton value="internal">Konnector staff</ToggleButton>
            <ToggleButton value="client">Client users</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            size="small"
            label="Search users"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ minWidth: 240 }}
          />
          <Box sx={{ flex: 1 }} />
          <SavedNote text={note} />
        </Stack>
        {(update.error || resend.error) && (
          <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
            {(update.error ?? resend.error)!.message}
          </Alert>
        )}
        {error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error.message}
          </Alert>
        ) : isLoading ? (
          <Skeleton variant="rounded" height={240} sx={{ m: 2 }} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No users match"
            body="Clear the search or switch between staff and client users."
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label={scope === 'internal' ? 'Konnector staff' : 'Client users'}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Organization</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((u) => {
                  const self = u.id === me?.user.id;
                  return (
                    <TableRow key={u.id} hover data-testid={`user-${u.email}`}>
                      <TableCell>
                        <Typography fontWeight={600} fontSize={14}>
                          {u.name}
                          {self && ' (you)'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {u.email}
                        </Typography>
                      </TableCell>
                      <TableCell>{u.orgName}</TableCell>
                      <TableCell>
                        <Tooltip title={self ? 'Ask another Admin to change your role' : ''}>
                          <span>
                            <Select
                              size="small"
                              value={u.role}
                              disabled={self || update.isPending}
                              onChange={(e) => changeRole(u, e.target.value as Role)}
                              inputProps={{ 'aria-label': `Role for ${u.name}` }}
                              sx={{ minWidth: 170 }}
                            >
                              {rolesForOrg({ type: u.orgType }).map((r) => (
                                <MenuItem key={r} value={r}>
                                  {ROLE_LABEL[r]}
                                </MenuItem>
                              ))}
                            </Select>
                          </span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {u.deactivatedAt ? (
                          <Chip
                            size="small"
                            icon={<BlockOutlined />}
                            label="Deactivated"
                            color="warning"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            size="small"
                            icon={<CheckCircleOutline />}
                            label="Active"
                            color="success"
                            variant="outlined"
                          />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            startIcon={<ForwardToInboxOutlined />}
                            disabled={Boolean(u.deactivatedAt) || resend.isPending}
                            onClick={() =>
                              resend.mutate(u.id, {
                                onSuccess: (r) => setNote(`Invite re-sent to ${r.sentTo}.`),
                              })
                            }
                            aria-label={`Re-send invite to ${u.name}`}
                          >
                            Re-send invite
                          </Button>
                          {!self && (
                            <Button
                              size="small"
                              color={u.deactivatedAt ? 'primary' : 'warning'}
                              disabled={update.isPending}
                              onClick={() => setActive(u, Boolean(u.deactivatedAt))}
                              aria-label={`${u.deactivatedAt ? 'Reactivate' : 'Deactivate'} ${u.name}`}
                            >
                              {u.deactivatedAt ? 'Reactivate' : 'Deactivate'}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </AdminPage>
  );
}
