/**
 * Application errors carry a stable machine-readable code and an HTTP status.
 * Their messages are safe to show to clients; anything else becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

export const badRequest = (code = "bad_request", details?: unknown) => new AppError(400, code, undefined, details);
export const unauthorized = (code = "unauthorized") => new AppError(401, code);
export const forbidden = (code = "forbidden") => new AppError(403, code);
/** Used both for missing resources and for resources the caller may not see (prevents IDOR probing). */
export const notFound = (code = "not_found") => new AppError(404, code);
export const conflict = (code = "conflict") => new AppError(409, code);
/** Postgres unique_violation (23505), also when wrapped by the ORM. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const tooManyRequests = (code = "too_many_requests") => new AppError(429, code);
