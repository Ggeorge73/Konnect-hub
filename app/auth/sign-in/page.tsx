import { isSupabaseConfigured } from '@/lib/config';
import { enabledOAuthProviders } from '@/lib/auth/oauth';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const configured = isSupabaseConfigured();
  // Google / Microsoft buttons only when Supabase Auth is configured (never in demo mode).
  const providers = configured ? enabledOAuthProviders(process.env.AUTH_OAUTH_PROVIDERS) : [];
  return <SignInForm configured={configured} reason={reason} providers={providers} />;
}
