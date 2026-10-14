import { Paper } from '@mui/material';
import { getSession } from '@/lib/session';
import { EmptyState } from '@/components/ui/bits';
import { Approvals } from '@/features/ledger/Approvals';

export const metadata = { title: 'Time approvals' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const s = await getSession();
  if (s.user.role !== 'admin' && s.user.role !== 'delivery_lead')
    return (
      <Paper sx={{ borderRadius: 4 }}>
        <EmptyState
          title="Approvals are for Delivery Leads and Admins"
          body="Your Lead approves your submitted time. You can follow its status on your timesheet."
        />
      </Paper>
    );
  return <Approvals />;
}
