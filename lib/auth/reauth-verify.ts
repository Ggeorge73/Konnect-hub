import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '../supabase/server';
import { authenticatedAt, type AuthClaims } from '../supabase/policy';
import { REAUTH_WINDOW_MS } from '../domain/gates';

/**
 * Supabase-mode "Confirm it's you" before a gate or acceptance decision (KH-47 SEC-03, finding F-01).
 * Re-typing an email proves nothing once real sign-in is on, so the server accepts either:
 * - the account password, checked with a throw-away, non-persisting Supabase client (the extra
 *   session it creates is signed out again at once and never reaches the browser), or
 * - a sign-in that itself happened within the 15-minute window (magic-link and Google/Microsoft
 *   users have no password: they sign in again, then decide).
 */
export async function verifyPassword(userId: string, email: string, password: string): Promise<boolean> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || data.user?.id !== userId) return false;
  await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
}

/** True when the current Supabase session was signed into within the re-auth window. */
export async function signedInRecently(now = Date.now()): Promise<boolean> {
  const { data } = await (await createSupabaseServerClient()).auth.getClaims();
  const at = data?.claims ? authenticatedAt(data.claims as AuthClaims) : undefined;
  return at !== undefined && now - at * 1000 <= REAUTH_WINDOW_MS;
}
