/**
 * Email delivery over SMTP — SDD section 1.1.
 *
 * One shared Nodemailer transport, cached on `globalThis` so hot reload and the
 * worker's five-minute loop do not open a new SMTP connection every pass.
 *
 * Deliverability is the real risk here, not code: SDD section 10.4 is explicit
 * that without SPF, DKIM and DMARC on the jaraaglobal.com domain the overdue
 * mails land in spam and the product fails quietly.
 */
import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

import {
  PermanentChannelError,
  TransientChannelError,
  type ChannelRecipient,
  type NotificationChannel,
  type OutboundNotification,
} from './types';

const log = moduleLogger('email-channel');

const globalForMail = globalThis as unknown as { jtasTransport?: Transporter };

function transport(): Transporter {
  if (globalForMail.jtasTransport) return globalForMail.jtasTransport;

  const config = env();

  const created = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    // Mailpit in development accepts anything; production uses real credentials.
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    // The sweeper already retries with backoff, so a hung connection should
    // fail fast rather than hold a batch slot open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  globalForMail.jtasTransport = created;
  return created;
}

/**
 * SMTP codes in the 5xx range are permanent; 4xx and transport errors are not.
 *
 * Exported for its unit test: getting this wrong is expensive in both
 * directions — a misread 4xx drops mail that would have gone through on the
 * next try, and a misread 5xx retries a dead address five times, pushing the
 * real failures off the end of the FAILED list.
 */
export function classifySmtpError(error: unknown): Error {
  const code = (error as { responseCode?: number }).responseCode;
  const message = error instanceof Error ? error.message : String(error);

  if (typeof code === 'number' && code >= 500 && code < 600) {
    return new PermanentChannelError(`SMTP rejected the message: ${message}`, { cause: error });
  }

  return new TransientChannelError(`SMTP delivery failed: ${message}`, { cause: error });
}

export const emailChannel: NotificationChannel = {
  key: 'EMAIL',

  async send(notification: OutboundNotification, user: ChannelRecipient) {
    if (!user.email) {
      throw new PermanentChannelError(`${user.name} has no email address.`);
    }

    try {
      const info = await transport().sendMail({
        from: env().MAIL_FROM,
        to: `${user.name} <${user.email}>`,
        subject: notification.subject,
        text: notification.body,
        html: notification.html,
        headers: {
          // Lets a reply or a bounce be traced back to the exact row.
          'X-JTAS-Notification': notification.id,
          'X-JTAS-Type': notification.type,
        },
      });

      log.debug({ notificationId: notification.id, messageId: info.messageId }, 'mail sent');

      return { providerId: info.messageId };
    } catch (error) {
      throw classifySmtpError(error);
    }
  },
};

/** Test seam: drops the cached transport so a new config is picked up. */
export function resetEmailTransport(): void {
  globalForMail.jtasTransport = undefined;
}
