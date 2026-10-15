import { readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/lib/data/errors';

/**
 * KH-47 SEC-03: every API route handler, called with no session in Supabase mode, answers 401 (or
 * 404 for the documented demo-only / token routes) and leaks no data. The route list is read from
 * the filesystem, so a new app/api route is covered automatically.
 *
 * "No session" is simulated the way it looks in production: Supabase Auth is configured, the
 * Supabase client has no claims, so getApiSession() throws UnauthorizedError (lib/session.ts).
 */
vi.mock('@/lib/config', async (orig) => ({
  ...(await orig<typeof import('@/lib/config')>()),
  isSupabaseConfigured: () => true,
}));
vi.mock('@/lib/session', () => {
  const no = async () => {
    throw new UnauthorizedError('Sign in first.');
  };
  return {
    DEMO_USER_COOKIE: 'kh_user',
    DEFAULT_DEMO_USER: 'u_lead',
    getSession: no,
    getApiSession: no,
    getRealSession: no,
    previewSession: async () => null,
    sessionFor: () => {
      throw new Error('sessionFor must not be reached without a session');
    },
  };
});
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: null, error: new Error('Auth session missing!') }),
      signOut: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ data: {}, error: new Error('no code') }),
    },
  }),
}));
vi.mock('next/headers', () => {
  const jar = { get: () => undefined, getAll: () => [], has: () => false, set: () => undefined };
  return { cookies: async () => jar, headers: async () => new Headers() };
});

const API_DIR = path.resolve(__dirname, '../../app/api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Every app/api/**\/route.ts, as [url path, file]. */
export function listApiRoutes(dir = API_DIR): { route: string; file: string }[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(`${path.sep}route.ts`) || f === 'route.ts')
    .map((f) => ({
      route: '/api/' + path.dirname(f).split(path.sep).join('/'),
      file: path.join(dir, f),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

/** Routes that are not session-based and answer 404 without one (documented in docs/security-review.md). */
const NOT_SESSION_BASED: Record<string, string> = {
  '/api/dev/mock-crm': 'demo-mode only, 404 when Supabase is configured',
  '/api/dev/outbox': 'demo-mode only, 404 when Supabase is configured',
  '/api/integrations/crm/events':
    'HMAC-signed by the CRM instead of a session; 401 without a valid signature',
  '/api/onboarding/reset': 'demo-mode only, 404 when Supabase is configured',
  '/api/projects/[key]/calendar.ics': 'feed token instead of a session; every failure is 404',
  '/api/session/mfa': '404 without DATABASE_URL, else 401 without Supabase claims',
};
/** Session route POST (persona switch) is demo-mode only: 404 when Supabase is configured. */
const NOT_FOUND_METHODS = new Set(['POST /api/session']);

const LEAK = /Peachtree|Riverbend|Konnector LLC|EHR-\d|@[a-z]+\.example|konnectortech\.com|costRate|"bac"/i;

const params = { key: 'EHR', id: 'dl_ehr_1', cid: 'ac_1', userId: 'u_dev', entity: 'items' };

describe('every API route without a session (Supabase mode)', () => {
  const routes = listApiRoutes();
  beforeAll(() => {
    delete process.env.CRON_SECRET;
    delete process.env.DATABASE_URL;
  });

  it('finds the route handlers on disk', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(routes.map((r) => r.route)).toContain('/api/items/[key]');
    expect(routes.map((r) => r.route)).toContain('/api/session/preview');
  });

  for (const { route, file } of listApiRoutes()) {
    it(`${route} refuses every method`, async () => {
      const mod = (await import(file)) as Record<string, unknown>;
      const methods = METHODS.filter((m) => typeof mod[m] === 'function');
      expect(methods.length, `${route} exports no handler`).toBeGreaterThan(0);
      for (const m of methods) {
        const url = `http://localhost${route.replace(/\[(\w+)\]/g, (_, p: keyof typeof params) => params[p])}?projectId=p_ehr&project=EHR&q=EHR&format=csv`;
        const req = new Request(url, {
          method: m,
          headers: { 'content-type': 'application/json' },
          body:
            m === 'GET'
              ? undefined
              : JSON.stringify({ userId: 'u_admin', email: 'x@y.z', status: 'accepted' }),
        });
        const res = (await (mod[m] as (r: Request, c: unknown) => Promise<Response>)(req, {
          params: Promise.resolve(params),
        })) as Response;
        const body = await res.text();
        const allowed =
          NOT_SESSION_BASED[route] || NOT_FOUND_METHODS.has(`${m} ${route}`) ? [401, 404] : [401];
        expect(allowed, `${m} ${route} -> ${res.status} ${body.slice(0, 120)}`).toContain(res.status);
        expect(body, `${m} ${route} leaks data`).not.toMatch(LEAK);
        expect(res.headers.get('set-cookie') ?? '', `${m} ${route} sets a cookie`).toBe('');
      }
    });
  }
});
