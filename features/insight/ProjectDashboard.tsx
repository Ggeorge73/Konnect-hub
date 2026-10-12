'use client';
import { Alert, Skeleton, Stack } from '@mui/material';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import type { DashboardView } from '@/lib/data/insight';
import { useDashboard } from './api';
import { DashboardBody } from './DashboardBody';

/** /projects/[key]/dashboard — the executive one-pager inside the project frame. */
export function ProjectDashboard() {
  const { project } = useProjectBundle();
  const { data, error, isLoading } = useDashboard(project.key);
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data)
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={120} />
        <Skeleton variant="rounded" height={240} />
      </Stack>
    );
  return <DashboardBody view={data} />;
}

/** Client portal variant: server-loaded, client-safe view, kept fresh with the same query. */
export function PortalDashboard({ view }: { view: DashboardView }) {
  const { data } = useDashboard(view.projectKey, view);
  return <DashboardBody view={data ?? view} portal />;
}
