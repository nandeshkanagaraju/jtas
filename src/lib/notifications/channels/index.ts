/**
 * The channel registry — SDD section 5.5.
 *
 * Keyed by `NotifChannel`, so adding WhatsApp in Phase 3 (FR-59) is a new file
 * and one entry here. The sweeper never learns a channel's name.
 */
import type { NotifChannel } from '@prisma/client';

import { emailChannel } from './email';
import { inAppChannel } from './in-app';
import type { NotificationChannel } from './types';

const registry: Partial<Record<NotifChannel, NotificationChannel>> = {
  EMAIL: emailChannel,
  IN_APP: inAppChannel,
  // WHATSAPP and SMS land in Phase 3; a row addressed to one before then is
  // reported by `channelFor` rather than silently dropped.
};

/** @throws {Error} when a row names a channel that is not implemented yet. */
export function channelFor(key: NotifChannel): NotificationChannel {
  const channel = registry[key];
  if (!channel) {
    throw new Error(`No notification channel is registered for ${key}.`);
  }
  return channel;
}

/** Test seam: swap a channel for a fake without touching the sweeper. */
export function registerChannel(channel: NotificationChannel): void {
  registry[channel.key] = channel;
}

export * from './types';
export { emailChannel } from './email';
export { inAppChannel } from './in-app';
