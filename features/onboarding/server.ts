import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getWorkspace } from '@/lib/data/onboarding';
import { ONBOARDING_SEEN_COOKIE, shouldRedirectToOnboarding } from '@/lib/domain/onboarding';

/**
 * Sends an Admin to the first-run wizard once from `/` while the workspace has no onboardedAt.
 * The wizard sets the "seen" cookie, so closing it and coming back to `/` does not loop.
 */
export async function redirectToOnboardingOnce() {
  const s = await getSession();
  if (s.user.role !== 'admin') return;
  const seen = (await cookies()).get(ONBOARDING_SEEN_COOKIE)?.value === '1';
  if (shouldRedirectToOnboarding(s.user, await getWorkspace(s), seen)) redirect('/onboarding');
}
