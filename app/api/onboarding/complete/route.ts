import { handle } from '@/lib/api';
import { completeOnboarding } from '@/lib/data/onboarding';

export const POST = () => handle(({ session }) => completeOnboarding(session));
