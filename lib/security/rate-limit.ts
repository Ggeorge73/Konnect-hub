/**
 * Pluggable rate limiter (KH-47 SEC-03). Pure TypeScript with no Node-only APIs, so it runs in the
 * Edge middleware as well as in route handlers and unit tests.
 *
 * - `RateLimitStore` is the backend interface. `MemoryRateLimitStore` (the default) keeps a
 *   sliding log of hit times per key in this server instance. A shared backend (Upstash Redis,
 *   Redis, Postgres) implements the same `hit()` so limits hold across serverless instances:
 *   e.g. a Redis sorted set per key with ZREMRANGEBYSCORE + ZADD + ZCARD in one MULTI.
 * - `RATE_LIMIT_RULES` maps request paths and methods to a policy (limit per window).
 * - `rateLimitResponse()` returns a 429 with `Retry-After` when the caller is over the limit.
 */

export interface RateLimitPolicy {
  /** Stable name; part of the bucket key and of the 429 body. */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the next request would be allowed (0 when allowed). */
  retryAfterS: number;
}

export interface RateLimitStore {
  hit(key: string, policy: RateLimitPolicy, now?: number): Promise<RateLimitResult> | RateLimitResult;
}

/**
 * In-memory sliding-window log. Exact (no fixed-window burst at the boundary), O(limit) memory per
 * key, and swept periodically so idle keys don't accumulate. Per instance only: on a multi-instance
 * deployment each instance enforces the limit on its own share of traffic (see the interface note).
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(private readonly maxKeys = 50_000) {}

  hit(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
    this.sweep(now, policy.windowMs);
    const since = now - policy.windowMs;
    const log = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (log.length >= policy.limit) {
      this.hits.set(key, log);
      const retryAfterS = Math.max(1, Math.ceil((log[0]! + policy.windowMs - now) / 1000));
      return { allowed: false, limit: policy.limit, remaining: 0, retryAfterS };
    }
    log.push(now);
    this.hits.set(key, log);
    return { allowed: true, limit: policy.limit, remaining: policy.limit - log.length, retryAfterS: 0 };
  }

  /** Number of tracked keys (for tests). */
  get size() {
    return this.hits.size;
  }

  reset() {
    this.hits.clear();
  }

  private sweep(now: number, windowMs: number) {
    if (now - this.lastSweep < 60_000 && this.hits.size < this.maxKeys) return;
    this.lastSweep = now;
    const horizon = now - Math.max(windowMs, 60 * 60_000);
    for (const [k, log] of this.hits) if (!log.length || log[log.length - 1]! <= horizon) this.hits.delete(k);
    // Still too many keys (e.g. a spray of spoofed IPs): drop the oldest half rather than grow.
    if (this.hits.size >= this.maxKeys)
      for (const k of [...this.hits.keys()].slice(0, Math.floor(this.hits.size / 2))) this.hits.delete(k);
  }
}

const MIN = 60_000;

/** The policies. Generous enough for real use and the e2e suite; tight enough to stop brute force. */
export const POLICIES = {
  /** Sign-in callback, MFA flag, demo persona switch: credential-adjacent. */
  auth: { name: 'auth', limit: 60, windowMs: MIN },
  /** "Confirm it's you" before an approval: a password/email guess per request. */
  reauth: { name: 'reauth', limit: 10, windowMs: MIN },
  /** Unauthenticated, token-addressed feeds (ICS) and cron endpoints. */
  public: { name: 'public', limit: 60, windowMs: MIN },
  /** Invites send email; the onboarding reset rewrites workspace state. */
  invite: { name: 'invite', limit: 20, windowMs: MIN },
  /** CSV / Excel / JSON / PDF generation is CPU-heavy. */
  export: { name: 'export', limit: 30, windowMs: MIN },
  /** View-as-client preview start/stop. */
  preview: { name: 'preview', limit: 30, windowMs: MIN },
  /** Every other mutating API request (POST / PUT / PATCH / DELETE). */
  mutation: { name: 'mutation', limit: 600, windowMs: MIN },
} as const satisfies Record<string, RateLimitPolicy>;

interface Rule {
  test: (path: string, method: string) => boolean;
  policy: RateLimitPolicy;
}

const isMutation = (m: string) => !['GET', 'HEAD', 'OPTIONS'].includes(m);

/** First matching rule wins. Paths are URL pathnames. */
export const RATE_LIMIT_RULES: Rule[] = [
  { test: (p, m) => p === '/api/reauth' && isMutation(m), policy: POLICIES.reauth },
  { test: (p, m) => p === '/api/session/preview' && isMutation(m), policy: POLICIES.preview },
  {
    test: (p, m) =>
      (p === '/api/session' && m === 'POST') ||
      p === '/api/session/mfa' ||
      p === '/auth/callback' ||
      p === '/auth/sign-out',
    policy: POLICIES.auth,
  },
  {
    test: (p) =>
      /^\/api\/projects\/[^/]+\/calendar\.ics$/.test(p) ||
      p === '/api/notifications/digest' ||
      p === '/api/raid/escalate' ||
      p.startsWith('/api/integrations/crm/'),
    policy: POLICIES.public,
  },
  {
    test: (p, m) => (p === '/api/onboarding/invites' && m === 'POST') || p === '/api/onboarding/reset',
    policy: POLICIES.invite,
  },
  {
    test: (p) =>
      p.startsWith('/api/exports/') ||
      /^\/api\/projects\/[^/]+\/(export\.json|dashboard\.pdf|acceptance-record)$/.test(p),
    policy: POLICIES.export,
  },
  { test: (p, m) => p.startsWith('/api/') && isMutation(m), policy: POLICIES.mutation },
];

export function policyFor(path: string, method: string): RateLimitPolicy | null {
  return RATE_LIMIT_RULES.find((r) => r.test(path, method.toUpperCase()))?.policy ?? null;
}

/**
 * The client identity used as the bucket key: the first X-Forwarded-For hop (set by Vercel and
 * most proxies), else X-Real-IP, else 'local'. Deploy behind a proxy that overwrites these headers;
 * otherwise a caller can rotate them to dodge the limit (documented in docs/security-review.md).
 */
export function clientKey(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (xff || headers.get('x-real-ip')?.trim() || 'local').slice(0, 64);
}

let defaultStore: RateLimitStore = new MemoryRateLimitStore();

/** Swap the backend (e.g. an Upstash/Redis store at startup, or a fresh memory store in tests). */
export function setRateLimitStore(store: RateLimitStore) {
  defaultStore = store;
}
export const getRateLimitStore = () => defaultStore;

/** `KH_RATE_LIMIT=off` disables limiting (local load tests only; never in production). */
export const rateLimitEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.KH_RATE_LIMIT !== 'off';

/** Checks one request. Returns null when allowed (or unlimited), else the 429 response. */
export async function rateLimitResponse(
  req: { method: string; headers: Headers; nextUrl?: { pathname: string }; url: string },
  store: RateLimitStore = defaultStore,
  now = Date.now(),
): Promise<Response | null> {
  const path = req.nextUrl?.pathname ?? new URL(req.url).pathname;
  const policy = policyFor(path, req.method);
  if (!policy) return null;
  const r = await store.hit(`${policy.name}:${clientKey(req.headers)}`, policy, now);
  if (r.allowed) return null;
  return new Response(
    JSON.stringify({ error: 'Too many requests. Try again shortly.', policy: policy.name }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(r.retryAfterS),
        'x-ratelimit-limit': String(r.limit),
        'x-ratelimit-remaining': '0',
      },
    },
  );
}
