import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Per-user, per-project calendar feed token (ICS-01): `<base64url(userId)>.<HMAC(userId|projectId)>`.
 * The token resolves to the user, so the feed applies that user's visibility rules. Rotating
 * ICS_SECRET revokes every feed URL. Falls back to 'dev-secret' in demo mode.
 */
const secret = () => process.env.ICS_SECRET ?? 'dev-secret';
const mac = (userId: string, projectId: string, key: string) =>
  createHmac('sha256', key).update(`ics|${userId}|${projectId}`).digest('base64url');

export function signCalendarToken(userId: string, projectId: string, key = secret()) {
  return `${Buffer.from(userId).toString('base64url')}.${mac(userId, projectId, key)}`;
}

/** Returns the user id, or null when the token is malformed, tampered or for another project. */
export function verifyCalendarToken(
  token: string | null | undefined,
  projectId: string,
  key = secret(),
): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const userId = Buffer.from(token.slice(0, dot), 'base64url').toString();
  if (!userId) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(userId, projectId, key));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return userId;
}
