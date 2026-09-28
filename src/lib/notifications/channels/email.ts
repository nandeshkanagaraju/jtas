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
import { getSettingArray, getSettingNumber, getSettingString } from '@/lib/services/settings';
import { moduleLogger } from '@/lib/utils/logger';

import { isAllowedRecipient, mailGuardConfig } from '../mail-guard';

import {
  PermanentChannelError,
  TransientChannelError,
  type ChannelRecipient,
  type NotificationChannel,
  type OutboundNotification,
} from './types';

const log = moduleLogger('email-channel');

const globalForMail = globalThis as unknown as {
  jtasTransport?: Transporter;
  /** The config the cached transport was built from. */
  jtasTransportKey?: string;
};

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Extra addresses copied on MD-facing mail. */
  mdRecipients: string[];
}

/**
 * The effective mail configuration: settings first, environment second.
 *
 * SDD 10.3 puts the SMTP credentials in the environment, and that stays the
 * default. The `mail.*` settings override them at runtime so a mail outage can
 * be fixed from /settings in a minute rather than a redeploy — which is the
 * whole reason those fields exist, and they were doing nothing until this read
 * them.
 */
async function mailConfig(): Promise<MailConfig> {
  const config = env();

  const [host, port, user, pass, from, mdRecipients] = await Promise.all([
    getSettingString('mail.smtp_host', ''),
    getSettingNumber('mail.smtp_port', 0),
    getSettingString('mail.smtp_user', ''),
    getSettingString('mail.smtp_password', ''),
    getSettingString('mail.from', ''),
    getSettingArray<string>('mail.md_recipients', []),
  ]);

  const effectiveHost = host || config.SMTP_HOST;
  const effectivePort = port || config.SMTP_PORT;

  return {
    host: effectiveHost,
    port: effectivePort,
    // 465 is implicit TLS; everything else starts plain and upgrades. Derived
    // rather than configured, because a host/port that disagrees with the flag
    // fails as a timeout nobody can read.
    secure: effectivePort === 465 ? true : config.SMTP_SECURE,
    user: user || config.SMTP_USER || '',
    pass: pass || config.SMTP_PASS || '',
    from: from || config.MAIL_FROM,
    mdRecipients,
  };
}

/**
 * The transport, rebuilt when the configuration changes.
 *
 * Keyed on everything but the password, plus whether a password is set — so a
 * changed credential still rebuilds the connection pool without the secret
 * appearing in a cache key that might be logged.
 */
async function transport(): Promise<{ transporter: Transporter; config: MailConfig }> {
  const config = await mailConfig();
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.pass.length}`;

  if (globalForMail.jtasTransport && globalForMail.jtasTransportKey === key) {
    return { transporter: globalForMail.jtasTransport, config };
  }

  const created = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Mailpit in development accepts anything; production uses real credentials.
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    // The sweeper already retries with backoff, so a hung connection should
    // fail fast rather than hold a batch slot open.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  globalForMail.jtasTransport = created;
  globalForMail.jtasTransportKey = key;

  return { transporter: created, config };
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

/** Types the MD and their deputies receive, which the extra CC list applies to. */
const MD_FACING = new Set(['OVERDUE_MD', 'PROBLEM_RAISED', 'DAILY_DIGEST_MD', 'JOB_COMPLETED']);

export const emailChannel: NotificationChannel = {
  key: 'EMAIL',

  async send(notification: OutboundNotification, user: ChannelRecipient) {
    if (!user.email) {
      throw new PermanentChannelError(`${user.name} has no email address.`);
    }

    try {
      const { transporter, config } = await transport();

      /*
       * SDD 3.4's `mail.md_recipients` — "extra CC addresses". Copied on the
       * MD-facing types only: a member does not need the accountant on their
       * reminder, and copying everything would make the CC meaningless.
       *
       * Filtered through the allowlist, because the dispatcher's check sees
       * the recipient and knows nothing about a CC list loaded from an
       * operator-editable setting. Without this, adding an address on the
       * settings screen would put mail in front of it that the guard was
       * holding back.
       */
      const { allowlist } = mailGuardConfig();
      const cc = (MD_FACING.has(notification.type) ? config.mdRecipients : []).filter((address) =>
        isAllowedRecipient(address, allowlist),
      );

      const info = await transporter.sendMail({
        from: config.from,
        to: `${user.name} <${user.email}>`,
        ...(cc.length > 0 ? { cc } : {}),
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
  globalForMail.jtasTransportKey = undefined;
}

/** What the transport would actually use, for the settings screen to show. */
export { mailConfig };
