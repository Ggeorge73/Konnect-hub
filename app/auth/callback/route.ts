import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/config';
import { recordLogin } from '@/lib/data/audit';
import { requestIp } from '@/lib/export-http';

/** Magic-link landing: exchanges the PKCE code for a session cookie, then enters the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/', url));
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // AUD-01: audit the sign-in; never block the redirect on it.
      if (data.user) await recordLogin(data.user.id, 'magic_link', requestIp(req)).catch(console.error);
      return NextResponse.redirect(new URL('/', url));
    }
  }
  return NextResponse.redirect(new URL('/auth/sign-in?reason=link-failed', url));
}
