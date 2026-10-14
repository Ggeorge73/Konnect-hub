import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { REAUTH_WINDOW_MS } from './domain/gates';
import { serverSecret } from './security/secrets';

/**
 * Fresh re-auth for approvals (CLAUDE.md §4: within 15 minutes).
 * Demo mode: the user re-enters their email; we set an httpOnly cookie holding the
 * ISO time of the re-auth, signed with an HMAC bound to the user id.
 * With Supabase this is replaced by a password/OTP re-verification that sets the same cookie.
 */
export const REAUTH_COOKIE = 'kh_reauth';

/** REAUTH_SECRET; 'dev-secret' only in demo mode (lib/security/secrets.ts). */
const secret = () => serverSecret('REAUTH_SECRET');
const mac = (userId: string, iso: string, key: string) =>
  createHmac('sha256', key).update(`${userId}|${iso}`).digest('base64url');

export function signReauth(userId: string, iso: string, key = secret()) {
  return `${iso}.${mac(userId, iso, key)}`;
}

/** Returns the signed ISO time, or null when missing, malformed, tampered or for another user. */
export function verifyReauth(token: string | undefined, userId: string, key = secret()): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const iso = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(userId, iso, key));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export async function getReauthAt(userId: string) {
  const jar = await cookies();
  return verifyReauth(jar.get(REAUTH_COOKIE)?.value, userId);
}

export const REAUTH_MAX_AGE_S = REAUTH_WINDOW_MS / 1000;
