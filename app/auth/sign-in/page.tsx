import { isSupabaseConfigured } from '@/lib/config';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <SignInForm configured={isSupabaseConfigured()} reason={reason} />;
}
