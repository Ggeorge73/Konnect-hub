import { ForbiddenError, ValidationError } from '../data/errors';

/**
 * AI errors. They extend the domain errors so `handle()` (lib/api.ts) maps their own status
 * without a change to lib/data/errors.ts.
 */

/** AI is off for this project (409). */
export class AiDisabledError extends ValidationError {
  status = 409;
  constructor() {
    super(
      'AI assist is off for this project. The Delivery Lead or an Admin can turn it on from the Overview tab.',
    );
  }
}

/** No provider configured, or the provider failed or declined (503). */
export class AiUnavailableError extends ValidationError {
  status = 503;
}

/** The model's output did not match the expected shape (502). Nothing is saved. */
export class AiOutputError extends ValidationError {
  status = 502;
  constructor(detail?: string) {
    super(`The AI response could not be used${detail ? ` (${detail})` : ''}. Nothing was saved; try again.`);
  }
}

/** Per-user rate limit on AI endpoints (429). */
export class AiRateLimitedError extends ForbiddenError {
  status = 429;
  constructor(public retryAfterSeconds: number) {
    super(`Too many AI requests. Try again in ${retryAfterSeconds} s.`);
  }
}
