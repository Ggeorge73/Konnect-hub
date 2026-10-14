import { getRepo } from '@/lib/data';
import { getSession } from '@/lib/session';
import { getWorkspace } from '@/lib/data/onboarding';
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Set up your workspace' };

export default async function Page() {
  const s = await getSession();
  const [workspace, orgs] = await Promise.all([getWorkspace(s), getRepo().listOrgs(s)]);
  return (
    <OnboardingWizard
      workspace={workspace}
      clients={orgs.filter((o) => o.type === 'client')}
      me={{ id: s.user.id, name: s.user.name }}
    />
  );
}
