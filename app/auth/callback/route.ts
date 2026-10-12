import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/config';

/** Magic-link landing: exchanges the PKCE code for a session cookie, then enters the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL('/', url));
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL('/', url));
  }
  return NextResponse.redirect(new URL('/auth/sign-in?reason=link-failed', url));
}
