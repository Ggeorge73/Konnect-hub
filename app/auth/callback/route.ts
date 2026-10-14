import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/config';
import { callbackErrorReason, linkDecision } from '@/lib/auth/oauth';
import { getSql, loadSession } from '@/lib/data/postgres';
import { recordLogin } from '@/lib/data/audit';
import { requestIp } from '@/lib/export-http';

/**
 * Magic-link and Google / Microsoft landing (KH-41): exchanges the PKCE code for a session cookie,
 * then lets the user in only if an invited profile matches the signed-in identity. Anyone else is
 * signed out again and sent to /auth/invite; no account or profile is ever created here. Internal
 * roles still go through /auth/mfa next (lib/session.ts), because an OAuth session is aal1.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/', url));
  const refused = callbackErrorReason(url.searchParams);
  if (refused === 'invite') return NextResponse.redirect(new URL('/auth/invite', url));
  const code = url.searchParams.get('code');
  if (!refused && code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const session = process.env.DATABASE_URL ? await loadSession(getSql(), data.user.id) : null;
      if (process.env.DATABASE_URL && linkDecision(data.user, session?.user ?? null) !== 'ok') {
        await supabase.auth.signOut();
        return NextResponse.redirect(new URL('/auth/invite', url));
      }
      // AUD-01: audit the sign-in (after the invite check); never block the redirect on it.
      const provider = (data.user.app_metadata?.provider as string | undefined) ?? 'email';
      const method = provider === 'email' ? 'magic_link' : `oauth_${provider}`;
      await recordLogin(data.user.id, method, requestIp(req)).catch(console.error);
      return NextResponse.redirect(new URL('/', url));
    }
  }
  return NextResponse.redirect(new URL('/auth/sign-in?reason=link-failed', url));
}
