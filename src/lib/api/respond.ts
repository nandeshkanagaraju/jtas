/**
 * The only place a route handler turns a value or a thrown error into an HTTP
 * response (architecture rule 2: handlers authenticate, validate, call a
 * service, and map errors).
 */
import { NextResponse } from 'next/server';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';

import { AppError, isAppError, validationError } from '@/lib/errors';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('api');

/** A successful JSON response. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

/** A successful response with no body. */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Maps any thrown value to the documented error envelope.
 *
 * An `AppError` is deliberate and its message is safe to show. Anything else is
 * a bug: it is logged with its stack and replaced with a generic 500, so an
 * internal detail never reaches the browser.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    return NextResponse.json(error.toBody(), {
      status: error.status,
      headers: error.headers,
    });
  }

  if (error instanceof ZodError) {
    return toErrorResponse(zodToAppError(error));
  }

  log.error({ err: error }, 'unhandled error in route handler');

  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
    { status: 500 },
  );
}

/**
 * Turns a Zod failure into a `VALIDATION_ERROR` whose `details.fields` maps
 * each invalid field path to its messages, which is what the form layer needs
 * to highlight inputs.
 */
export function zodToAppError(error: ZodError): AppError {
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    (fields[path] ??= []).push(issue.message);
  }

  return validationError('Please correct the highlighted fields.', { fields });
}

/**
 * Parses a JSON request body against a shared Zod schema.
 *
 * @throws {AppError} `VALIDATION_ERROR` on malformed JSON or a schema failure.
 */
export async function parseJson<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<TypeOf<S>> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw validationError('Request body must be valid JSON.');
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw zodToAppError(result.error);
  }

  return result.data;
}

/** Parses `URLSearchParams` against a shared Zod schema. */
export function parseQuery<S extends ZodTypeAny>(url: URL, schema: S): TypeOf<S> {
  const result = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!result.success) {
    throw zodToAppError(result.error);
  }
  return result.data;
}

/**
 * Wraps a route handler so every thrown `AppError` becomes the documented
 * envelope and every unexpected throw becomes a logged 500.
 */
export function handler<Args extends unknown[]>(
  fn: (request: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (request: Request, ...args: Args): Promise<NextResponse> => {
    try {
      return await fn(request, ...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
