import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { canAdminister } from '@/lib/domain/admin';
import { FieldsAdmin } from '@/features/admin/FieldsAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Custom fields · Admin' };

/** Admin console (ADM-01): Admin only; everyone else goes home. */
export default async function Page() {
  const s = await getSession();
  if (!canAdminister(s.user)) redirect('/');
  return <FieldsAdmin />;
}
