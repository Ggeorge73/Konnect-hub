export class ForbiddenError extends Error {
  status = 403;
}
export class NotFoundError extends Error {
  status = 404;
}
export class ValidationError extends Error {
  status = 400;
}
export const errorStatus = (e: unknown) =>
  e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof ValidationError ? e.status : 500;
