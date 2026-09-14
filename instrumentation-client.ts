/**
 * Browser start-up.
 *
 * Only NEXT_PUBLIC_SENTRY_DSN is readable here — the server DSN must never be
 * inlined into a bundle. They are usually the same project; keeping them as two
 * variables makes it a decision rather than an accident.
 */
import * as Sentry from '@sentry/nextjs';

import { sentryOptions } from '@/lib/observability/sentry';

Sentry.init({
  ...sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN),
  // No session replay: the shop floor's screens carry customer part numbers and
  // drawing references, and recording them to a third party is not something
  // anybody here has agreed to.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
