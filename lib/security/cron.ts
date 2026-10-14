import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * True when the request carries `x-cron-secret` equal to CRON_SECRET (constant-time). False when
 * CRON_SECRET is unset or shorter than 16 characters, so a blank or trivial secret never opens the
 * scheduled endpoints (POST /api/notifications/digest, POST /api/raid/escalate).
 */
export function cronAuthorized(
  headers: Headers,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret || secret.length < 16) return false;
  const given = headers.get('x-cron-secret');
  if (!given) return false;
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(given), h(secret));
}
