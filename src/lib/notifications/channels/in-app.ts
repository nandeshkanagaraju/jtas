/**
 * In-app delivery — SDD section 5.5.
 *
 * A no-op by design: the `Notification` row *is* the inbox. Marking it `SENT`
 * is all "delivery" means, and the sweeper does that itself. This exists so the
 * registry is total and the sweeper never has to special-case a channel.
 */
import type { NotificationChannel } from './types';

export const inAppChannel: NotificationChannel = {
  key: 'IN_APP',
  async send() {
    return {};
  },
};
