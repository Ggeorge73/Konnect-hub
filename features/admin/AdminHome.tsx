'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import MailOutline from '@mui/icons-material/MailOutline';
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import ViewWeekOutlined from '@mui/icons-material/ViewWeekOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import { api, qk } from '@/lib/client/api';
import { Mono } from '@/components/ui/bits';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { workspaceDisplayName, type Invite, type WorkspaceSettings } from '@/lib/domain/onboarding';

/**
 * /admin: the Admin console (ADM-01, spec 3.11) as a card grid. Every screen behind these cards is
 * Admin only and every change it makes is written to the audit log.
 */
const CONSOLE: {
  icon: typeof RocketLaunchOutlined;
  title: string;
  body: string;
  href: string;
  cta: string;
}[] = [
  {
    icon: PeopleAltOutlined,
    title: 'Users',
    body: 'Konnector staff and client users: change roles, deactivate, re-send invites.',
    href: '/admin/users',
    cta: 'Manage users',
  },
  {
    icon: BusinessOutlined,
    title: 'Client organizations',
    body: 'Add clients, rename them and upload their logos for the portal.',
    href: '/admin/clients',
    cta: 'Manage clients',
  },
  {
    icon: ContentCopyOutlined,
    title: 'Project templates',
    body: 'The three built-in templates, and your own with tailored exit criteria and RAID categories.',
    href: '/admin/templates',
    cta: 'Manage templates',
  },
  {
    icon: ViewWeekOutlined,
    title: 'Workflows',
    body: 'Rename board columns and set WIP limits per project. Accepted stays client-only.',
    href: '/admin/workflows',
    cta: 'Configure workflows',
  },
  {
    icon: TuneOutlined,
    title: 'Custom fields',
    body: 'Text, number, date and select fields on every work item, internal or shared.',
    href: '/admin/fields',
    cta: 'Manage fields',
  },
  {
    icon: HistoryOutlined,
    title: 'Audit log',
    body: 'Who changed what, when and from where. Append-only.',
    href: '/admin/audit',
    cta: 'Open the audit log',
  },
];

export function AdminHome({
  workspace,
  demoProject,
  invites,
}: {
  workspace: WorkspaceSettings;
  demoProject: { key: string; name: string } | null;
  invites: Invite[];
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Admin</Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <SetupCard workspace={workspace} />
        </Grid>
        {CONSOLE.map((c) => (
          <Grid key={c.href} size={{ xs: 12, md: 6, lg: 4 }}>
            <AdminCard
              icon={c.icon}
              title={c.title}
              actions={
                <Button component={Link} href={c.href}>
                  {c.cta}
                </Button>
              }
            >
              <Typography variant="body2" color="text.secondary">
                {c.body}
              </Typography>
            </AdminCard>
          </Grid>
        ))}
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <DemoProjectCard demoProject={demoProject} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <InvitesCard invites={invites} />
        </Grid>
      </Grid>
    </Stack>
  );
}

function AdminCard({
  icon: Icon,
  title,
  children,
  actions,
}: {
  icon: typeof RocketLaunchOutlined;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const id = `admin-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <Card
      component="section"
      aria-labelledby={id}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <CardContent sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Icon color="primary" aria-hidden />
          <Typography variant="h3" component="h2" id={id}>
            {title}
          </Typography>
        </Stack>
        {children}
      </CardContent>
      {actions && <CardActions sx={{ px: 2, pb: 2 }}>{actions}</CardActions>}
    </Card>
  );
}

function SetupCard({ workspace }: { workspace: WorkspaceSettings }) {
  return (
    <AdminCard
      icon={RocketLaunchOutlined}
      title="Branding and setup"
      actions={
        <Button variant="contained" component={Link} href="/onboarding">
          Re-run setup
        </Button>
      }
    >
      <Typography>{workspaceDisplayName(workspace)}</Typography>
      <Typography variant="body2" color="text.secondary">
        {workspace.onboardedAt ? (
          <>
            Set up <Mono>{new Date(workspace.onboardedAt).toLocaleDateString()}</Mono>. Re-run the wizard to
            change the workspace name and logo, add a client or invite people.
          </>
        ) : (
          'Setup has not been finished yet. Run the wizard to name the workspace and add your first client.'
        )}
      </Typography>
    </AdminCard>
  );
}

function DemoProjectCard({ demoProject }: { demoProject: { key: string; name: string } | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/demo', { method: 'DELETE' });
      setOpen(false);
      setDeleted(true);
      await qc.invalidateQueries({ queryKey: qk.projects });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminCard
      icon={DeleteOutline}
      title="Demo project"
      actions={
        demoProject && !deleted ? (
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteOutline />}
            onClick={() => setOpen(true)}
          >
            Delete demo project
          </Button>
        ) : (
          <Button component={Link} href="/projects">
            Go to projects
          </Button>
        )
      }
    >
      {demoProject && !deleted ? (
        <Typography variant="body2" color="text.secondary">
          <Mono>{demoProject.key}</Mono> · {demoProject.name} shows sample items, sprints, risks and a passed
          gate. Delete it once your team has found its way around.
        </Typography>
      ) : (
        <Typography variant="body2" color="text.secondary" role="status">
          The demo project has been deleted. It stays in the audit log.
        </Typography>
      )}
      <Dialog
        open={open}
        onClose={busy ? undefined : () => setOpen(false)}
        aria-labelledby="delete-demo-title"
      >
        <DialogTitle id="delete-demo-title">Delete the demo project?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {demoProject?.name} and its sample data disappear for everyone, including the Peachtree portal.
            Admins can still find it in the audit log.
          </DialogContentText>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={remove} disabled={busy}>
            Delete demo project
          </Button>
        </DialogActions>
      </Dialog>
    </AdminCard>
  );
}

function InvitesCard({ invites }: { invites: Invite[] }) {
  return (
    <AdminCard
      icon={MailOutline}
      title="Pending invites"
      actions={
        <Button component={Link} href="/admin/invites">
          Invite people
        </Button>
      }
    >
      {invites.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No invites are pending. Invite your team or client users by email.
        </Typography>
      ) : (
        <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2 }}>
          {invites.slice(0, 6).map((i) => (
            <li key={i.id}>
              <Typography variant="body2">
                {i.email} · {ROLE_LABEL[i.role]}
              </Typography>
            </li>
          ))}
          {invites.length > 6 && (
            <Typography component="li" variant="body2" color="text.secondary">
              and {invites.length - 6} more
            </Typography>
          )}
        </Stack>
      )}
    </AdminCard>
  );
}
