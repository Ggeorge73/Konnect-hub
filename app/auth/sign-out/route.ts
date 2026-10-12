import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/config';

/** POST-only so a link prefetch can't sign anyone out. */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) await (await createSupabaseServerClient()).auth.signOut();
  return NextResponse.redirect(new URL('/auth/sign-in', req.url), { status: 303 });
}
