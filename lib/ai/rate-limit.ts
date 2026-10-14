/**
 * Per-user rate limit for AI endpoints: a token bucket per key, in memory. The limiter is
 * pluggable (`setAiRateLimiter`) so a shared store (e.g. Redis or Postgres) can replace it when
 * the app runs on more than one instance.
 */
export interface RateDecision {
  ok: boolean;
  /** Tokens left after this call (when ok). */
  remaining: number;
  /** Seconds until the next token (when not ok). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  take(key: string, now?: number): RateDecision;
}

export interface TokenBucketOptions {
  /** Burst size, and the number of calls allowed per `perMs`. */
  capacity: number;
  perMs: number;
}

/** Refills continuously at capacity / perMs tokens per millisecond. */
export function createTokenBucket({ capacity, perMs }: TokenBucketOptions): RateLimiter {
  if (!(capacity > 0) || !(perMs > 0)) throw new Error('Token bucket needs a positive capacity and window.');
  const rate = capacity / perMs;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key, now = Date.now()) {
      const b = buckets.get(key) ?? { tokens: capacity, at: now };
      b.tokens = Math.min(capacity, b.tokens + Math.max(0, now - b.at) * rate);
      b.at = now;
      buckets.set(key, b);
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, remaining: Math.floor(b.tokens), retryAfterSeconds: 0 };
      }
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)),
      };
    },
  };
}

/** Calls per user per minute (env KH_AI_RATE_PER_MIN, default 10). */
export const aiRatePerMinute = (env: Record<string, string | undefined> = process.env) => {
  const n = Number(env.KH_AI_RATE_PER_MIN);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10;
};

const g = globalThis as unknown as { __khAiLimiter?: RateLimiter };

export const aiRateLimiter = (): RateLimiter =>
  (g.__khAiLimiter ??= createTokenBucket({ capacity: aiRatePerMinute(), perMs: 60_000 }));

/** Replace the limiter (tests, or a shared store in production). */
export const setAiRateLimiter = (l: RateLimiter | undefined) => {
  g.__khAiLimiter = l;
};
