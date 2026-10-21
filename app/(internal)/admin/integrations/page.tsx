import { Paper } from '@mui/material';
import { getSession } from '@/lib/session';
import { EmptyState } from '@/components/ui/bits';
import { IntegrationsAdmin } from '@/features/integrations/IntegrationsAdmin';

export const metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

/** Admin only: the Konnector CRM event log, failures and retries. */
export default async function Page() {
  const s = await getSession();
  if (s.user.role !== 'admin')
    return (
      <Paper sx={{ borderRadius: 4 }}>
        <EmptyState title="Admins only" body="Integrations are visible to Konnector Admins." />
      </Paper>
    );
  return <IntegrationsAdmin />;
}
