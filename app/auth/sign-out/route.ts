import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/config';
import { REAUTH_COOKIE } from '@/lib/reauth';
import { PREVIEW_COOKIE } from '@/lib/security/request-guard';

/** POST-only so a link prefetch can't sign anyone out. Also ends any re-auth window and preview. */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) await (await createSupabaseServerClient()).auth.signOut();
  const res = NextResponse.redirect(new URL('/auth/sign-in', req.url), { status: 303 });
  for (const name of [REAUTH_COOKIE, PREVIEW_COOKIE]) res.cookies.set(name, '', { path: '/', maxAge: 0 });
  return res;
}
