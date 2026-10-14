import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { updateSession } from '@/lib/supabase/middleware';
import { rateLimitEnabled, rateLimitResponse } from '@/lib/security/rate-limit';
import {
  contentSecurityPolicy,
  csrfCheck,
  PREVIEW_COOKIE,
  previewBlocks,
} from '@/lib/security/request-guard';

const deny = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Runs before every page, route handler and server action (KH-47 SEC-03):
 * 1. rate limits (lib/security/rate-limit.ts): 429 + Retry-After;
 * 2. CSRF: state-changing requests must be same-origin (lib/security/request-guard.ts);
 * 3. "View as client" preview is read-only: any write but "exit preview" / "sign out" is 403;
 * 4. a per-request nonce-based Content-Security-Policy (Next.js applies the nonce to its scripts);
 * 5. keeps Supabase Auth cookies fresh (no-op in demo mode).
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const method = request.method.toUpperCase();

  if (rateLimitEnabled()) {
    const limited = await rateLimitResponse(request);
    if (limited) return limited;
  }
  if (csrfCheck(method, path, request.headers) === 'cross-site')
    return deny(403, 'Cross-site request refused.');
  if (previewBlocks(method, path, request.cookies.has(PREVIEW_COOKIE))) return deny(403, 'preview_read_only');

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const response = isSupabaseConfigured()
    ? await updateSession(request, headers)
    : NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
