import type { Role } from '../domain/types';
import { isInternalRole } from '../domain/permissions';

/** Session max age (CLAUDE.md §4 Security): 12 hours for Konnector staff, 7 days for clients. */
export const INTERNAL_MAX_AGE_S = 12 * 60 * 60;
export const CLIENT_MAX_AGE_S = 7 * 24 * 60 * 60;

/** The subset of Supabase access-token claims the session policy reads. */
export interface AuthClaims {
  aal?: string;
  iat?: number;
  auth_time?: number;
  amr?: ({ method: string; timestamp: number } | string)[];
}

/**
 * When the user actually signed in (seconds since epoch). `iat` moves on every token refresh,
 * so prefer `auth_time`, then the earliest `amr` timestamp (Supabase's per-method sign-in times),
 * and fall back to `iat` only if neither is present.
 */
export function authenticatedAt(c: AuthClaims): number | undefined {
  if (typeof c.auth_time === 'number') return c.auth_time;
  const stamps = (c.amr ?? [])
    .map((a) => (typeof a === 'string' ? undefined : a.timestamp))
    .filter((t): t is number => typeof t === 'number');
  if (stamps.length) return Math.min(...stamps);
  return typeof c.iat === 'number' ? c.iat : undefined;
}

export const maxSessionAge = (role: Role) => (isInternalRole(role) ? INTERNAL_MAX_AGE_S : CLIENT_MAX_AGE_S);

export type SessionDecision = 'ok' | 'expired' | 'mfa_required';

/**
 * Applies the auth policy to a signed-in user: sessions older than the role's max age must
 * sign in again, and internal users must have completed TOTP (aal2). MFA is optional for clients.
 */
export function checkSessionPolicy(
  role: Role,
  claims: AuthClaims,
  nowS = Date.now() / 1000,
): SessionDecision {
  const at = authenticatedAt(claims);
  if (at === undefined || nowS - at > maxSessionAge(role)) return 'expired';
  if (isInternalRole(role) && claims.aal !== 'aal2') return 'mfa_required';
  return 'ok';
}
