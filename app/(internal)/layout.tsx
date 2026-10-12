import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getSession } from '@/lib/session';
import { isClientRole } from '@/lib/domain/permissions';

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (isClientRole(s.user.role)) redirect('/portal');
  return <AppShell>{children}</AppShell>;
}
