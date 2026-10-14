import { PortfolioPage } from '@/features/portfolio/PortfolioPage';
import { redirectToOnboardingOnce } from '@/features/onboarding/server';

export default async function Page() {
  await redirectToOnboardingOnce(); // Team Portal (ONB-01): first-run wizard for Admins
  return <PortfolioPage />;
}
