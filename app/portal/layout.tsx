import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isClientRole } from '@/lib/domain/permissions';
import { PortalShell } from '@/features/portal/PortalShell';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!isClientRole(s.user.role)) redirect('/');
  return (
    <PortalShell orgName={s.org.name} userName={s.user.name}>
      {children}
    </PortalShell>
  );
}
