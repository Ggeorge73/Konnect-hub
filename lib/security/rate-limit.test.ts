import { describe, expect, it } from 'vitest';
import {
  clientKey,
  MemoryRateLimitStore,
  POLICIES,
  policyFor,
  rateLimitEnabled,
  rateLimitResponse,
  type RateLimitStore,
} from './rate-limit';

const policy = { name: 't', limit: 3, windowMs: 10_000 };

describe('MemoryRateLimitStore (sliding window log)', () => {
  it('allows up to the limit, then refuses with a Retry-After until the oldest hit expires', () => {
    const s = new MemoryRateLimitStore();
    expect(s.hit('k', policy, 0)).toMatchObject({ allowed: true, remaining: 2 });
    expect(s.hit('k', policy, 1_000).remaining).toBe(1);
    expect(s.hit('k', policy, 2_000).remaining).toBe(0);
    const refused = s.hit('k', policy, 3_000);
    expect(refused).toMatchObject({ allowed: false, remaining: 0, retryAfterS: 7 });
    // Sliding, not fixed: at 9.9 s the first hit is still inside the window.
    expect(s.hit('k', policy, 9_900).allowed).toBe(false);
    // At 10.001 s the hit from t=0 has slid out, so exactly one more is allowed.
    expect(s.hit('k', policy, 10_001).allowed).toBe(true);
    expect(s.hit('k', policy, 10_002).allowed).toBe(false);
  });

  it('refused requests do not extend the window', () => {
    const s = new MemoryRateLimitStore();
    for (let t = 0; t < 3; t++) s.hit('k', policy, t);
    for (let t = 100; t < 5_000; t += 100) expect(s.hit('k', policy, t).allowed).toBe(false);
    expect(s.hit('k', policy, 10_001).allowed).toBe(true);
  });

  it('keeps keys apart', () => {
    const s = new MemoryRateLimitStore();
    for (let i = 0; i < 3; i++) s.hit('a', policy, 0);
    expect(s.hit('a', policy, 0).allowed).toBe(false);
    expect(s.hit('b', policy, 0).allowed).toBe(true);
  });

  it('sweeps idle keys and caps memory under a key spray', () => {
    const s = new MemoryRateLimitStore(100);
    for (let i = 0; i < 500; i++) s.hit(`ip${i}`, policy, i);
    expect(s.size).toBeLessThanOrEqual(100);
    s.hit('late', policy, 5 * 60 * 60_000);
    expect(s.size).toBe(1);
  });
});

describe('policyFor', () => {
  it.each([
    ['POST', '/api/reauth', 'reauth'],
    ['POST', '/api/session', 'auth'],
    ['POST', '/api/session/mfa', 'auth'],
    ['GET', '/auth/callback', 'auth'],
    ['POST', '/api/session/preview', 'preview'],
    ['DELETE', '/api/session/preview', 'preview'],
    ['GET', '/api/projects/EHR/calendar.ics', 'public'],
    ['POST', '/api/notifications/digest', 'public'],
    ['POST', '/api/raid/escalate', 'public'],
    ['POST', '/api/integrations/crm/events', 'public'],
    ['POST', '/api/onboarding/invites', 'invite'],
    ['POST', '/api/onboarding/reset', 'invite'],
    ['GET', '/api/exports/items', 'export'],
    ['GET', '/api/projects/EHR/export.json', 'export'],
    ['GET', '/api/projects/EHR/dashboard.pdf', 'export'],
    ['GET', '/api/projects/EHR/acceptance-record', 'export'],
    ['PATCH', '/api/items/EHR-1', 'mutation'],
    ['DELETE', '/api/demo', 'mutation'],
  ])('%s %s -> %s', (method, path, name) => {
    expect(policyFor(path, method)?.name).toBe(name);
  });

  it('does not limit ordinary reads or pages', () => {
    expect(policyFor('/api/items', 'GET')).toBeNull();
    expect(policyFor('/api/session', 'GET')).toBeNull();
    expect(policyFor('/api/reauth', 'GET')).toBeNull();
    expect(policyFor('/api/session/preview', 'GET')).toBeNull();
    expect(policyFor('/projects/EHR/board', 'GET')).toBeNull();
    expect(policyFor('/api/onboarding/invites', 'GET')).toBeNull();
  });

  it('keeps the auth-sensitive limits tight', () => {
    expect(POLICIES.reauth.limit).toBeLessThanOrEqual(10);
    expect(POLICIES.auth.limit).toBeLessThanOrEqual(60);
  });
});

describe('clientKey', () => {
  it('uses the first X-Forwarded-For hop, then X-Real-IP, then "local"', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientKey(new Headers())).toBe('local');
    expect(clientKey(new Headers({ 'x-forwarded-for': 'x'.repeat(500) }))).toHaveLength(64);
  });
});

describe('rateLimitResponse', () => {
  const req = (ip: string, path = '/api/reauth', method = 'POST') => ({
    method,
    url: `http://localhost${path}`,
    headers: new Headers({ 'x-forwarded-for': ip }),
  });

  it('returns null while allowed and a 429 with Retry-After once over the limit', async () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < POLICIES.reauth.limit; i++)
      expect(await rateLimitResponse(req('203.0.113.1'), store, 1_000)).toBeNull();
    const res = (await rateLimitResponse(req('203.0.113.1'), store, 1_000))!;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('x-ratelimit-limit')).toBe(String(POLICIES.reauth.limit));
    expect(await res.json()).toMatchObject({ policy: 'reauth' });
    // Another client is unaffected.
    expect(await rateLimitResponse(req('203.0.113.2'), store, 1_000)).toBeNull();
  });

  it('ignores unlimited requests without touching the store', async () => {
    const calls: string[] = [];
    const spy: RateLimitStore = {
      hit: (k) => {
        calls.push(k);
        return { allowed: true, limit: 1, remaining: 1, retryAfterS: 0 };
      },
    };
    expect(await rateLimitResponse(req('1.1.1.1', '/api/items', 'GET'), spy)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('works with an async (e.g. Redis) backend through the same interface', async () => {
    const remote: RateLimitStore = {
      hit: async () => ({ allowed: false, limit: 5, remaining: 0, retryAfterS: 42 }),
    };
    const res = (await rateLimitResponse(req('1.1.1.1'), remote))!;
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  it('can be switched off for local load tests only', () => {
    expect(rateLimitEnabled({})).toBe(true);
    expect(rateLimitEnabled({ KH_RATE_LIMIT: 'off' })).toBe(false);
  });
});
