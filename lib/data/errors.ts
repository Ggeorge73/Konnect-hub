export class ForbiddenError extends Error {
  status = 403;
}
export class NotFoundError extends Error {
  status = 404;
}
export class ValidationError extends Error {
  status = 400;
}
/** 401 for a decision without a fresh re-auth. Extends ForbiddenError so `handle()` maps its status. */
export class ReauthRequiredError extends ForbiddenError {
  status = 401;
  constructor() {
    super('reauth_required');
  }
}
/** 401: no (valid) session on an API request (KH-47). Extends ForbiddenError so `errorStatus` maps it. */
export class UnauthorizedError extends ForbiddenError {
  status = 401;
}
export const errorStatus = (e: unknown) =>
  e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof ValidationError ? e.status : 500;
