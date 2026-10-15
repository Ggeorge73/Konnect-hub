import Link from 'next/link';
import { Button, Card, CardActionArea, Paper, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { PortalProjectCard } from '@/features/portal/PortalProjectCard';
import { ApprovalInbox } from '@/features/portal/ApprovalInbox';
import { SubmitRequestButton } from '@/features/portal/RequestDialog';
import { getApprovalInbox } from '@/lib/data/portal';
import { canActOnApprovals, canSubmitRequest } from '@/lib/domain/portal';
import { EmptyState } from '@/components/ui/bits';
import { ForYourReview } from '@/features/portal/ForYourReview';
import { listItems } from '@/lib/integration/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client portal' };

export default async function Portal() {
  const s = await getSession();
  const repo = getRepo();
  const [projects, inbox, review] = await Promise.all([
    repo.listProjects(s),
    getApprovalInbox(s),
    listItems(s),
  ]);
  const bundles = await Promise.all(projects.map((p) => repo.getProjectBundle(s, p.key)));
  const requestable = canSubmitRequest(s.user.role)
    ? projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))
    : [];
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
      >
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h1">Welcome, {s.user.name.split(' ')[0]}</Typography>
          <Typography color="text.secondary">{s.org.name}</Typography>
        </Stack>
        {requestable.length > 0 && <SubmitRequestButton projects={requestable} />}
      </Stack>
      <ApprovalInbox
        initial={inbox}
        canAct={canActOnApprovals(s.user.role)}
        emptyAction={
          projects.length > 0 ? (
            <Button variant="outlined" href="#projects">
              Check on your projects
            </Button>
          ) : undefined
        }
      />
      <ForYourReview items={review} projectNames={Object.fromEntries(projects.map((p) => [p.id, p.name]))} />
      <Stack spacing={1.5} component="section" id="projects" aria-labelledby="projects-title">
        <Typography variant="h2" id="projects-title">
          Your projects
        </Typography>
        {bundles.length === 0 ? (
          <Paper sx={{ borderRadius: 4 }}>
            <EmptyState
              title="No projects shared yet"
              body="Your Konnector delivery lead adds your projects here as soon as work starts. Reach out to them if you expected to see one."
            />
          </Paper>
        ) : (
          <Grid container spacing={2}>
            {bundles.map((b) => (
              <Grid key={b.project.id} size={{ xs: 12, md: 6 }}>
                <Card>
                  <CardActionArea component={Link} href={`/portal/${b.project.key}`}>
                    <PortalProjectCard
                      project={projects.find((p) => p.id === b.project.id)!}
                      phases={b.phases}
                    />
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Stack>
    </Stack>
  );
}
