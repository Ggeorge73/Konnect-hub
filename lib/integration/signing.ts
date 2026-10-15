import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `X-Konnector-Signature: t=<unix ms>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, the scheme
 * the CRM uses in both directions. The timestamp is signed too, so a captured request cannot be
 * replayed after MAX_SKEW_MS.
 */
export const SIGNATURE_HEADER = 'x-konnector-signature';
export const EVENT_HEADER = 'x-konnector-event';

/** Max clock skew accepted on inbound calls. */
export const MAX_SKEW_MS = 5 * 60_000;

export function sign(body: string, secret: string, t: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${mac}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verify(
  body: string,
  header: string | null,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  if (!header) return { ok: false, reason: 'missing signature' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!t || !parts.v1) return { ok: false, reason: 'malformed signature' };
  if (Math.abs(now - t) > MAX_SKEW_MS) return { ok: false, reason: 'stale signature' };
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'bad signature' };
  return { ok: true };
}
