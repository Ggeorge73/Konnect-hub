import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canManageWorkspace } from '@/lib/domain/onboarding';
import { getDemoProject, getWorkspace, listInvites } from '@/lib/data/onboarding';
import { AdminHome } from '@/features/admin/AdminHome';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin' };

export default async function Page() {
  const s = await getSession();
  if (!canManageWorkspace(s.user)) redirect('/');
  const [workspace, demoProject, invites] = await Promise.all([
    getWorkspace(s),
    getDemoProject(s),
    listInvites(s),
  ]);
  return <AdminHome workspace={workspace} demoProject={demoProject} invites={invites} />;
}
