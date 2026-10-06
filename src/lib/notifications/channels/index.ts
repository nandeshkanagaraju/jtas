/**
 * The channel registry — SDD section 5.5.
 *
 * Keyed by `NotifChannel`, so adding WhatsApp in Phase 3 (FR-59) is a new file
 * and one entry here. The sweeper never learns a channel's name.
 */
import type { NotifChannel } from '@prisma/client';

import { brevoChannel } from './brevo';
import { emailChannel } from './email';
import { inAppChannel } from './in-app';
import { telegramChannel } from './telegram';
import type { NotificationChannel } from './types';

const registry: Partial<Record<NotifChannel, NotificationChannel>> = {
  IN_APP: inAppChannel,
  TELEGRAM: telegramChannel,
  // EMAIL is resolved on first use from MAIL_PROVIDER — see below.
  // WHATSAPP and SMS land in Phase 3; a row addressed to one before then is
  // reported by `channelFor` rather than silently dropped.
};

/**
 * Which adapter EMAIL means — SMTP unless `MAIL_PROVIDER=brevo`.
 *
 * SMTP stays the default so local development keeps pointing at Mailpit and
 * nothing about a developer's setup changes. Switching a whole environment to
 * a provider is then one variable, and the sweeper never learns which one it
 * got: the registry is the seam SDD 5.5 put here for exactly this.
 *
 * Resolved lazily rather than at import, because the environment is read
 * lazily too, and eagerly reading it here would make importing this module
 * require a fully populated environment in every unit test.
 */
function resolveEmailChannel(): NotificationChannel {
  const provider = (process.env.MAIL_PROVIDER ?? 'smtp').trim().toLowerCase();
  return provider === 'brevo' ? brevoChannel : emailChannel;
}

/** @throws {Error} when a row names a channel that is not implemented yet. */
export function channelFor(key: NotifChannel): NotificationChannel {
  if (key === 'EMAIL' && !registry.EMAIL) {
    registry.EMAIL = resolveEmailChannel();
  }

  const channel = registry[key];
  if (!channel) {
    throw new Error(`No notification channel is registered for ${key}.`);
  }
  return channel;
}

/**
 * Test seam: forgets the resolved EMAIL adapter so the next `channelFor`
 * re-reads `MAIL_PROVIDER`.
 */
export function resetEmailChannelChoice(): void {
  delete registry.EMAIL;
}

/** Test seam: swap a channel for a fake without touching the sweeper. */
export function registerChannel(channel: NotificationChannel): void {
  registry[channel.key] = channel;
}

export * from './types';
export { brevoChannel } from './brevo';
export { emailChannel } from './email';
export { inAppChannel } from './in-app';
export { telegramChannel } from './telegram';
