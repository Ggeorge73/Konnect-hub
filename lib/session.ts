import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Session } from './domain/types';
import { db } from './data/memory';
import { getRepo, isPostgresEnabled } from './data';
import { getSql, loadSession } from './data/postgres';
import { seedUserUuid } from './data/seed-ids';
import { UnauthorizedError } from './data/errors';
import { isSupabaseConfigured } from './config';
import { createSupabaseServerClient } from './supabase/server';
import { checkSessionPolicy, type AuthClaims } from './supabase/policy';
import { PREVIEW_COOKIE } from './security/request-guard';
import { impersonationOf, pickPreviewSubject, verifyPreview } from './security/preview';

export const DEMO_USER_COOKIE = 'kh_user';
export const DEFAULT_DEMO_USER = 'u_lead';

/** How a missing or invalid sign-in is reported: a page redirect, or a 401 for API callers. */
type OnNoSession = 'redirect' | 'throw';

/**
 * Resolves the signed-in user for pages and server components.
 * - Supabase configured: the Supabase Auth user (cookies), loaded from the database as that
 *   user. Internal roles must be at aal2 (TOTP) and sessions expire after 12 h (internal) or
 *   7 days (clients). Redirects to /auth/sign-in or /auth/mfa otherwise.
 * - Demo mode: the persona chosen with a cookie (role switcher). With KH_DATA=postgres and no
 *   Supabase Auth, the persona maps to its fixed seed uuid and is loaded from the database.
 * While an Admin previews the portal ("View as client"), the previewed client session is returned
 * with `impersonation` set; middleware.ts refuses every write meanwhile.
 */
export async function getSession(): Promise<Session> {
  return withPreview(await getRealSession('redirect'));
}

/**
 * The same for route handlers: a missing, expired or not-yet-MFA Supabase session throws
 * UnauthorizedError (401 JSON) instead of redirecting to an HTML page.
 */
export async function getApiSession(): Promise<Session> {
  return withPreview(await getRealSession('throw'));
}

/** The signed-in user, ignoring any preview (used to start and stop a preview). */
export async function getRealSession(onNoSession: OnNoSession = 'redirect'): Promise<Session> {
  if (isSupabaseConfigured()) return authSession(onNoSession);
  const jar = await cookies();
  const id = jar.get(DEMO_USER_COOKIE)?.value ?? DEFAULT_DEMO_USER;
  if (isPostgresEnabled())
    return (
      (await loadSession(getSql(), seedUserUuid(id))) ??
      (await loadSession(getSql(), seedUserUuid(DEFAULT_DEMO_USER)))!
    );
  return sessionFor(id);
}

async function authSession(onNoSession: OnNoSession): Promise<Session> {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required when Supabase Auth is configured (see README).');
  const refuse = (path: string, reason: string): never => {
    if (onNoSession === 'throw') throw new UnauthorizedError(reason);
    redirect(path);
  };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return refuse('/auth/sign-in', 'Sign in first.');
  const session = await loadSession(getSql(), claims.sub);
  if (!session) return refuse('/auth/sign-in?reason=no-profile', 'Sign in first.');
  const decision = checkSessionPolicy(session.user.role, claims as AuthClaims);
  if (decision === 'expired') return refuse('/auth/sign-in?reason=expired', 'session_expired');
  if (decision === 'mfa_required') return refuse('/auth/mfa', 'mfa_required');
  return session;
}

/** Demo store persona lookup (in-memory seed ids such as u_lead). */
export function sessionFor(userId: string): Session {
  const d = db();
  const user = d.profiles.find((p) => p.id === userId) ?? d.profiles.find((p) => p.id === DEFAULT_DEMO_USER)!;
  const org = d.orgs.find((o) => o.id === user.orgId)!;
  return { user, org };
}

/**
 * Applies a valid `kh_preview` cookie: only for a signed-in Admin, only with a signature bound to
 * that Admin, only within its max age. Anything else is ignored (the real session is returned).
 */
async function withPreview(real: Session): Promise<Session> {
  if (real.user.role !== 'admin') return real;
  const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!token) return real;
  const claim = verifyPreview(token, real.user.id);
  if (!claim) return real;
  return (await previewSession(real, claim.orgId, claim.role, claim.startedAt)) ?? real;
}

/** The read-only client session an Admin previews as, or null if the org has nobody in that role. */
export async function previewSession(
  admin: Session,
  orgId: string,
  role: Session['user']['role'],
  startedAt: string,
): Promise<Session | null> {
  const repo = getRepo();
  const [people, orgs] = await Promise.all([repo.listPeople(admin), repo.listOrgs(admin)]);
  const subject = pickPreviewSubject(people, orgs, orgId, role);
  if (!subject) return null;
  const base = isPostgresEnabled() ? await loadSession(getSql(), subject.id) : sessionFor(subject.id);
  if (!base || base.user.id !== subject.id) return null;
  return { ...base, impersonation: impersonationOf(admin.user, base.user, base.org, startedAt) };
}
