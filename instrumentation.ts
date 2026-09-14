/**
 * Server and edge start-up (Next.js instrumentation hook).
 *
 * `register` runs once per runtime before anything is served, which is the only
 * place Sentry can install its handlers early enough to catch a failure during
 * the first render.
 */
import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/observability/sentry';

export async function register() {
  Sentry.init(sentryOptions(process.env.SENTRY_DSN));
}

/**
 * Every uncaught error in a server component, route handler or middleware.
 *
 * The request id is attached as a tag, so an event and the pino line that
 * recorded the same failure can be put side by side.
 */
export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  Sentry.withScope((scope) => {
    const requestId = request.headers?.['x-request-id'];
    if (typeof requestId === 'string') scope.setTag('requestId', requestId);

    Sentry.captureRequestError(error, request, context);
  });
};
