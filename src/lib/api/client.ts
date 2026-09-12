/**
 * Browser-side API client.
 *
 * Two jobs: unwrap the documented error envelope into a throwable, and retry
 * once through `/api/auth/refresh` when the 15-minute access token has expired
 * mid-session. Without the retry, a user who left a tab open would get a
 * spurious failure on their next click.
 */
import type { ErrorBody, ErrorCode } from '@/lib/errors';

/** An API failure, carrying the server's code and field details. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Field-level messages, when the server supplied them. */
  readonly fields?: Record<string, string[]>;
  /**
   * The whole `details` object. Some errors carry more than field messages —
   * a deactivation CONFLICT lists the open subtasks blocking it — and the
   * dialog rendering that needs the structured value, not a sentence.
   */
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.details = body.details;
    const fields = body.details?.fields;
    this.fields = isFieldMap(fields) ? fields : undefined;
  }
}

function isFieldMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => Array.isArray(v))
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ErrorBody;
    if (body?.error?.code) return new ApiError(response.status, body.error);
  } catch {
    // Fall through to the generic message below.
  }

  return new ApiError(response.status, {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
  });
}

/**
 * Fetches a JSON endpoint.
 *
 * @throws {ApiError} on any non-2xx response.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  options: { retryOnExpiry?: boolean } = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    credentials: 'same-origin',
  });

  if (response.status === 401 && options.retryOnExpiry !== false) {
    const rotated = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });

    // Retry once. `retryOnExpiry: false` stops a rotation failure from looping.
    if (rotated.ok) {
      return apiFetch<T>(path, init, { retryOnExpiry: false });
    }
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
