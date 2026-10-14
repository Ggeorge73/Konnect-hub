'use client';
import { useState } from 'react';
import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import SendOutlined from '@mui/icons-material/SendOutlined';
import { useOrgs, useMe } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { rolesForOrg } from '@/lib/domain/admin';
import type { Role } from '@/lib/domain/types';
import { EmptyState, Mono } from '@/components/ui/bits';
import { AdminPage, SavedNote } from './AdminPage';
import { useAdminInvites, useInvite, useResendInvite, useRevokeInvite } from './api';

/**
 * /admin/invites (ADM-01): invite people by email with a role and an org. With Supabase the invite
 * is a magic link from Supabase Auth; in demo mode it lands in the dev outbox.
 */
export function InvitesAdmin() {
  const { data: me } = useMe();
  const { data: orgs = [] } = useOrgs();
  const { data: invites, isLoading, error } = useAdminInvites();
  const invite = useInvite();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();
  const [emails, setEmails] = useState('');
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<Role>('team_member');
  const [note, setNote] = useState<string | null>(null);
  const org = orgs.find((o) => o.id === (orgId || me?.org.id));
  const roles = org ? rolesForOrg(org) : [];
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? '—';

  const pickOrg = (id: string) => {
    setOrgId(id);
    const next = orgs.find((o) => o.id === id);
    if (next && !rolesForOrg(next).includes(role))
      setRole(rolesForOrg(next)[next.type === 'internal' ? 2 : 1]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    invite.mutate(
      { emails, role, orgId: org.id },
      {
        onSuccess: (created) => {
          setEmails('');
          setNote(
            created.length
              ? `Invited ${created.length} ${created.length === 1 ? 'person' : 'people'} to ${org.name}.`
              : 'Everyone on that list already has an account or an invite.',
          );
        },
      },
    );
  };

  return (
    <AdminPage
      title="Invites"
      intro="Invite Konnector staff or client users by email. Invites and re-sends are audited."
    >
      <Paper sx={{ borderRadius: 4, p: 2 }} component="form" onSubmit={submit} aria-label="Invite people">
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <TextField
              label="Emails"
              placeholder="name@konnectortech.com, another@client.example"
              helperText="Separate several with commas or new lines."
              multiline
              minRows={2}
              fullWidth
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              required
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              select
              label="Organization"
              fullWidth
              value={org?.id ?? ''}
              onChange={(e) => pickOrg(e.target.value)}
            >
              {orgs.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField
              select
              label="Role"
              fullWidth
              value={roles.includes(role) ? role : ''}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {roles.map((r) => (
                <MenuItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 2 }}>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              startIcon={<SendOutlined />}
              disabled={!emails.trim() || !org || !roles.includes(role) || invite.isPending}
              sx={{ height: 56 }}
            >
              Send invites
            </Button>
          </Grid>
        </Grid>
        <SavedNote text={note} />
        {invite.error && <Alert severity="error">{invite.error.message}</Alert>}
        <Typography variant="caption" color="text.secondary">
          With Supabase, each person gets a magic link and their profile is created with this role. In demo
          mode the email lands in the dev outbox (/api/dev/outbox).
        </Typography>
      </Paper>

      <Paper sx={{ borderRadius: 4 }}>
        <Typography variant="h3" component="h2" sx={{ p: 2, pb: 0 }}>
          Sent and pending
        </Typography>
        {(resend.error || revoke.error) && (
          <Alert severity="error" sx={{ m: 2 }}>
            {(resend.error ?? revoke.error)!.message}
          </Alert>
        )}
        {error ? (
          <Alert severity="error" sx={{ m: 2 }}>
            {error.message}
          </Alert>
        ) : isLoading ? (
          <Skeleton variant="rounded" height={160} sx={{ m: 2 }} />
        ) : !invites?.length ? (
          <EmptyState
            title="No invites yet"
            body="Invite your delivery team or a client sponsor with the form above."
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Invites">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Organization</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Sent</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invites.map((i) => (
                  <TableRow key={i.id} hover data-testid={`invite-${i.email}`}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{orgName(i.orgId)}</TableCell>
                    <TableCell>{ROLE_LABEL[i.role]}</TableCell>
                    <TableCell>
                      {i.sentCount ? (
                        <>
                          <Mono>{i.sentCount}×</Mono>, last <Mono>{i.lastSentAt?.slice(0, 10)}</Mono>
                        </>
                      ) : (
                        'Not sent yet'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button
                          size="small"
                          disabled={resend.isPending}
                          onClick={() =>
                            resend.mutate(i.id, { onSuccess: () => setNote(`Invite re-sent to ${i.email}.`) })
                          }
                          aria-label={`Re-send invite to ${i.email}`}
                        >
                          Re-send
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          disabled={revoke.isPending}
                          onClick={() => {
                            if (window.confirm(`Revoke the invite for ${i.email}?`))
                              revoke.mutate(i.id, {
                                onSuccess: () => setNote(`Invite for ${i.email} revoked.`),
                              });
                          }}
                          aria-label={`Revoke invite for ${i.email}`}
                        >
                          Revoke
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </AdminPage>
  );
}
