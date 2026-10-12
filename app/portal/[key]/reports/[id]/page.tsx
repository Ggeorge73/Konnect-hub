import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getReport } from '@/lib/data/reports';
import { NotFoundError } from '@/lib/data/errors';
import { PortalReport } from '@/features/reports/PortalReports';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Status report' };

export default async function Page({ params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const s = await getSession();
  const report = await getReport(s, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (report.projectKey !== key.toUpperCase()) notFound();
  return <PortalReport report={report} />;
}
