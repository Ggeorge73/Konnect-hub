import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canAdminister } from '@/lib/domain/admin';
import { TemplatesAdmin } from '@/features/admin/TemplatesAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Project templates · Admin' };

/** Admin console (ADM-01): Admin only; everyone else goes home. */
export default async function Page() {
  const s = await getSession();
  if (!canAdminister(s.user)) redirect('/');
  return <TemplatesAdmin />;
}
