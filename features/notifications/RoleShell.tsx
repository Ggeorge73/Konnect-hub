import { AppShell } from '@/components/shell/AppShell';
import { PortalShell } from '@/features/portal/PortalShell';
import { getSession } from '@/lib/session';
import { isClientRole } from '@/lib/domain/permissions';

/** Pages shared by staff and clients (notifications, settings) render in the right shell. */
export async function RoleShell({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (isClientRole(s.user.role))
    return (
      <PortalShell orgName={s.org.name} userName={s.user.name}>
        {children}
      </PortalShell>
    );
  return <AppShell>{children}</AppShell>;
}
