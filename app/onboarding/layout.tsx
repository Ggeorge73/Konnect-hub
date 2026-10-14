import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isClientRole } from '@/lib/domain/permissions';
import { canManageWorkspace } from '@/lib/domain/onboarding';
import { OnboardingShell } from '@/features/onboarding/OnboardingShell';

export const metadata = { title: 'Set up your workspace' };

/** First-run wizard: Admins only, outside the main shell so nothing distracts from setup. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (isClientRole(s.user.role)) redirect('/portal');
  if (!canManageWorkspace(s.user)) redirect('/');
  return <OnboardingShell>{children}</OnboardingShell>;
}
