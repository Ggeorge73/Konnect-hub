/**
 * Request guards applied in middleware.ts before any route handler, page or server action runs
 * (KH-47 SEC-03). Pure functions over method, path and headers, so they run on the Edge runtime and
 * in unit tests.
 */

export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;
export const isSafeMethod = (m: string) => (SAFE_METHODS as readonly string[]).includes(m.toUpperCase());

/** Name of the "View as client" preview cookie (set by /api/session/preview). */
export const PREVIEW_COOKIE = 'kh_preview';

/**
 * Endpoints called server-to-server by a scheduler with `x-cron-secret`, or by calendar apps with a
 * feed token. They carry no cookies, so cross-site request forgery does not apply to them.
 */
export const CSRF_EXEMPT: RegExp[] = [
  /^\/api\/notifications\/digest$/,
  /^\/api\/raid\/escalate$/,
  /^\/api\/projects\/[^/]+\/calendar\.ics$/,
  // Konnector CRM: HMAC-signed server-to-server calls and the integration cron.
  /^\/api\/integrations\/crm\/(events|cron)$/,
];

export type CsrfVerdict = 'ok' | 'cross-site';

/**
 * Same-origin check for state-changing requests. Browsers send `Sec-Fetch-Site` (all current
 * engines) and `Origin` on every cross-origin POST/PUT/PATCH/DELETE, so:
 * - safe methods and the exempt endpoints pass;
 * - `Sec-Fetch-Site` other than `same-origin` (or `none`, a user-typed navigation) is refused;
 * - otherwise an `Origin` whose host differs from the request host is refused (`Origin: null`
 *   from sandboxed frames and privacy redirects is refused too);
 * - a request with neither header is not from a browser page (curl, server-to-server, the
 *   Playwright request context). It carries no ambient browser credentials, so it passes.
 */
export function csrfCheck(method: string, path: string, headers: Headers): CsrfVerdict {
  if (isSafeMethod(method)) return 'ok';
  if (CSRF_EXEMPT.some((r) => r.test(path))) return 'ok';
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site';
  const origin = headers.get('origin');
  if (origin === null) return 'ok';
  const host = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0]!.trim();
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return 'cross-site'; // "null" or garbage
  }
  return host && originHost.toLowerCase() === host.toLowerCase() ? 'ok' : 'cross-site';
}

/**
 * While an Admin previews the portal as a client ("View as client", CLAUDE.md §2) the app is
 * read-only. These are the only state-changing requests allowed: leaving the preview and signing out.
 */
export const PREVIEW_ALLOWED_WRITES: { method: string; path: RegExp }[] = [
  { method: 'DELETE', path: /^\/api\/session\/preview$/ },
  { method: 'POST', path: /^\/auth\/sign-out$/ },
];

export function previewBlocks(method: string, path: string, previewing: boolean): boolean {
  if (!previewing || isSafeMethod(method)) return false;
  return !PREVIEW_ALLOWED_WRITES.some((w) => w.method === method.toUpperCase() && w.path.test(path));
}

/** Content-Security-Policy for one response. `nonce` is a fresh base64 value per request. */
export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    // Next.js adds the nonce to its own scripts when it sees this header on the request.
    // 'strict-dynamic' lets those scripts load the app's chunks; no inline script runs without it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // MUI / Emotion inject <style> tags at runtime; styles cannot execute script.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
