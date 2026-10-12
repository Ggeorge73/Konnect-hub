import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Session } from './domain/types';
import { db } from './data/memory';
import { isPostgresEnabled } from './data';
import { getSql, loadSession } from './data/postgres';
import { seedUserUuid } from './data/seed-ids';
import { isSupabaseConfigured } from './config';
import { createSupabaseServerClient } from './supabase/server';
import { checkSessionPolicy, type AuthClaims } from './supabase/policy';

export const DEMO_USER_COOKIE = 'kh_user';
export const DEFAULT_DEMO_USER = 'u_lead';

/**
 * Resolves the signed-in user.
 * - Supabase configured: the Supabase Auth user (cookies), loaded from the database as that
 *   user. Internal roles must be at aal2 (TOTP) and sessions expire after 12 h (internal) or
 *   7 days (clients). Redirects to /auth/sign-in or /auth/mfa otherwise.
 * - Demo mode: the persona chosen with a cookie (role switcher). With KH_DATA=postgres and no
 *   Supabase Auth, the persona maps to its fixed seed uuid and is loaded from the database.
 */
export async function getSession(): Promise<Session> {
  if (isSupabaseConfigured()) return authSession();
  const jar = await cookies();
  const id = jar.get(DEMO_USER_COOKIE)?.value ?? DEFAULT_DEMO_USER;
  if (isPostgresEnabled())
    return (
      (await loadSession(getSql(), seedUserUuid(id))) ??
      (await loadSession(getSql(), seedUserUuid(DEFAULT_DEMO_USER)))!
    );
  return sessionFor(id);
}

async function authSession(): Promise<Session> {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required when Supabase Auth is configured (see README).');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect('/auth/sign-in');
  const session = await loadSession(getSql(), claims.sub);
  if (!session) redirect('/auth/sign-in?reason=no-profile');
  const decision = checkSessionPolicy(session.user.role, claims as AuthClaims);
  if (decision === 'expired') redirect('/auth/sign-in?reason=expired');
  if (decision === 'mfa_required') redirect('/auth/mfa');
  return session;
}

/** Demo store persona lookup (in-memory seed ids such as u_lead). */
export function sessionFor(userId: string): Session {
  const d = db();
  const user = d.profiles.find((p) => p.id === userId) ?? d.profiles.find((p) => p.id === DEFAULT_DEMO_USER)!;
  const org = d.orgs.find((o) => o.id === user.orgId)!;
  return { user, org };
}
