import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canSeePortfolio } from '@/lib/domain/dashboard';
import { PortfolioDashboard } from '@/features/insight/PortfolioDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboards' };

/** DASH-02 portfolio dashboard. Internal only: Associates (and clients, via the layout) are redirected. */
export default async function Page() {
  const s = await getSession();
  if (!canSeePortfolio(s.user)) redirect('/?denied=dashboards');
  return <PortfolioDashboard />;
}
