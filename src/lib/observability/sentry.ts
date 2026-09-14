/**
 * Sentry, shared between the server, the edge and the browser (SDD 10.4).
 *
 * Off unless a DSN is set. Development and the test suite have none, so the SDK
 * initialises into a no-op and nothing leaves the machine — which also means a
 * developer never has to remember to turn it off.
 */
import type { NodeOptions } from '@sentry/nextjs';

/** The ingest origin a DSN points at, for the CSP's `connect-src`. */
export function sentryOrigin(dsn: string | undefined): string {
  if (!dsn) return '';

  try {
    return new URL(dsn).origin;
  } catch {
    return '';
  }
}

/**
 * Options every runtime shares.
 *
 * `sendDefaultPii` stays false: an event carries a stack and a request id, and
 * the request id is enough to find the matching log line — which is already
 * redacted. Shipping headers and cookies to a third party would undo the
 * scrubbing M11.3 put in.
 */
export function sentryOptions(dsn: string | undefined): NodeOptions {
  return {
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: process.env.NODE_ENV ?? 'development',
    sendDefaultPii: false,
    // A shop of forty people generates very little traffic; sampling would
    // mostly mean losing the one trace somebody asks about.
    tracesSampleRate: 0,
    // Errors only. Breadcrumbs from fetch bodies could carry a password on the
    // login request, and no amount of sampling makes that acceptable.
    maxBreadcrumbs: 20,
  };
}
