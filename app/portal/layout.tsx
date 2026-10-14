import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isClientRole } from '@/lib/domain/permissions';
import { PortalShell } from '@/features/portal/PortalShell';
import { getApprovalInbox, getPortalBranding } from '@/lib/data/portal';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!isClientRole(s.user.role)) redirect('/');
  const [branding, inbox] = await Promise.all([getPortalBranding(s), getApprovalInbox(s)]);
  return (
    <PortalShell orgName={s.org.name} userName={s.user.name} branding={branding} inbox={inbox}>
      {children}
    </PortalShell>
  );
}
