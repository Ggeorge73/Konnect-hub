import Link from 'next/link';
import { Stack, Typography } from '@mui/material';
import { getSession } from '@/lib/session';
import { getDashboard } from '@/lib/data/insight';
import { PortalDashboard } from '@/features/insight/ProjectDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

/** Client-safe executive dashboard. No budget or EVM unless the Lead shared the budget view. */
export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const view = await getDashboard(await getSession(), key.toUpperCase());
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="baseline" className="kh-no-print">
        <Link href={`/portal/${view.projectKey}`} style={{ color: 'inherit' }}>
          ← Back to project
        </Link>
      </Stack>
      <Typography variant="h1">{view.projectName}</Typography>
      <PortalDashboard view={view} />
    </Stack>
  );
}
