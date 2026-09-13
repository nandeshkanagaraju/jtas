/**
 * A capturing channel, so the notification tests can assert on what would have
 * been sent without an SMTP server in the loop.
 *
 * Registered over `EMAIL` in the same registry the sweeper resolves from, which
 * is the point of SDD 5.5 having a registry at all — the sweeper is exercised
 * unchanged.
 */
import { registerChannel, emailChannel } from '@/lib/notifications/channels';
import type {
  ChannelRecipient,
  NotificationChannel,
  OutboundNotification,
} from '@/lib/notifications/channels';

export interface CapturedMail {
  notificationId: string;
  type: string;
  subject: string;
  body: string;
  html?: string;
  to: string;
  userId: string;
}

const captured: CapturedMail[] = [];

/** Fails the next `n` sends, to exercise the retry path. */
let failuresRemaining = 0;
let failureFactory: (() => Error) | null = null;

export const capturingChannel: NotificationChannel = {
  key: 'EMAIL',
  async send(notification: OutboundNotification, user: ChannelRecipient) {
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failureFactory ? failureFactory() : new Error('SMTP unavailable');
    }

    captured.push({
      notificationId: notification.id,
      type: notification.type,
      subject: notification.subject,
      body: notification.body,
      html: notification.html,
      to: user.email,
      userId: user.id,
    });

    return { providerId: `test-${notification.id}` };
  },
};

/** Installs the capturing channel and clears anything captured before. */
export function useCapturingMail(): void {
  registerChannel(capturingChannel);
  captured.length = 0;
  failuresRemaining = 0;
  failureFactory = null;
}

/** Puts the real email channel back. */
export function restoreMail(): void {
  registerChannel(emailChannel);
}

export function sentMails(): CapturedMail[] {
  return [...captured];
}

export function mailsOfType(type: string): CapturedMail[] {
  return captured.filter((mail) => mail.type === type);
}

export function clearMails(): void {
  captured.length = 0;
}

/** Makes the next `count` sends throw, to exercise backoff and FAILED. */
export function failNextSends(count: number, factory?: () => Error): void {
  failuresRemaining = count;
  failureFactory = factory ?? null;
}
