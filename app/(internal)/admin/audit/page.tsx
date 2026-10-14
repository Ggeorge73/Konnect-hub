import { Paper } from '@mui/material';
import { getSession } from '@/lib/session';
import { EmptyState } from '@/components/ui/bits';
import { AuditViewer } from '@/features/audit/AuditViewer';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

/** AUD-01: Admin-only audit log viewer (its own route; the /admin landing page is another team's). */
export default async function Page() {
  const s = await getSession();
  if (s.user.role !== 'admin')
    return (
      <Paper sx={{ borderRadius: 4 }}>
        <EmptyState title="Admins only" body="The audit log is visible to Konnector Admins." />
      </Paper>
    );
  return <AuditViewer />;
}
