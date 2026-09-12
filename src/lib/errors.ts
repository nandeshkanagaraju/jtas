/**
 * Domain error type and the error envelope every API response uses.
 *
 * Services throw `AppError`; route handlers map it to HTTP through
 * `toErrorResponse` in `@/lib/api/respond`. Nothing else in the codebase
 * constructs an error body by hand, so the shape in SDD section 6.1 cannot
 * drift between endpoints.
 */

/**
 * Error codes. The first six are SDD section 6.1 verbatim; the last two are
 * additions the SDD requires behaviour for but does not name a code for:
 *
 *   - `RATE_LIMITED`  — section 8.7 mandates auth and write rate limits.
 *   - `INTERNAL_ERROR` — the catch-all, so an unexpected throw still produces
 *     the documented envelope rather than an HTML error page.
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'INVALID_TRANSITION',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status for each code. */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Machine-readable detail attached to a `VALIDATION_ERROR` and friends. */
export type ErrorDetails = Record<string, unknown>;

/** The response body shape. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
  };
}

/**
 * An error with an intended HTTP meaning.
 *
 * `message` is shown to the user, so it must never leak internals — no stack
 * traces, no SQL, and in the auth flow no hint about which half of a
 * credential pair was wrong.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  /** Extra HTTP headers the handler should set, e.g. `Retry-After`. */
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: ErrorDetails; headers?: Record<string, string>; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options?.details;
    this.headers = options?.headers;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** HTTP status for a code, for callers that have a code but not an error. */
export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

// --- Constructors for the codes used often enough to deserve a shorthand ----

export function unauthenticated(message = 'You are not signed in.'): AppError {
  return new AppError('UNAUTHENTICATED', message);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError('FORBIDDEN', message);
}

export function notFound(entity = 'Record'): AppError {
  return new AppError('NOT_FOUND', `${entity} not found.`);
}

export function validationError(message: string, details?: ErrorDetails): AppError {
  return new AppError('VALIDATION_ERROR', message, { details });
}

export function conflict(message: string, details?: ErrorDetails): AppError {
  return new AppError('CONFLICT', message, { details });
}

export function invalidTransition(message: string, details?: ErrorDetails): AppError {
  return new AppError('INVALID_TRANSITION', message, { details });
}

export function rateLimited(message: string, retryAfterSeconds: number): AppError {
  return new AppError('RATE_LIMITED', message, {
    details: { retryAfterSeconds },
    headers: { 'Retry-After': String(retryAfterSeconds) },
  });
}
