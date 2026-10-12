import Link from 'next/link';
import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { PortalProjectCard } from '@/features/portal/PortalProjectCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client portal' };

export default async function Portal() {
  const s = await getSession();
  const repo = getRepo();
  const projects = await repo.listProjects(s);
  const bundles = await Promise.all(projects.map((p) => repo.getProjectBundle(s, p.key)));
  const items = await repo.listItems(s, {});
  const awaiting = items.filter((i) => i.status === 'client_review');
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Welcome, {s.user.name.split(' ')[0]}</Typography>
      <Card>
        <CardContent>
          <Typography variant="h3" gutterBottom>
            Needs your approval ({awaiting.length})
          </Typography>
          {awaiting.length === 0 ? (
            <Typography color="text.secondary">Nothing is waiting on you right now.</Typography>
          ) : (
            awaiting.map((i) => (
              <Typography key={i.id} component="div" sx={{ py: 0.5 }}>
                <Link
                  href={`/portal/${projects.find((p) => p.id === i.projectId)?.key}?item=${i.key}`}
                  style={{ color: 'inherit' }}
                >
                  {i.key} · {i.title}
                </Link>
              </Typography>
            ))
          )}
        </CardContent>
      </Card>
      <Grid container spacing={2}>
        {bundles.map((b) => (
          <Grid key={b.project.id} size={{ xs: 12, md: 6 }}>
            <Card>
              <CardActionArea component={Link} href={`/portal/${b.project.key}`}>
                <PortalProjectCard project={projects.find((p) => p.id === b.project.id)!} phases={b.phases} />
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Stack>
  );
}
