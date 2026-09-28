/**
 * Email delivery through Brevo's transactional API — build spec M12.3.
 *
 * The HTTP API rather than Brevo's SMTP relay, deliberately. SMTP would have
 * been a two-line configuration change to the existing channel, and that is
 * exactly the problem: an SMTP failure arrives as a numeric code and a string,
 * so "you are out of credits for today" and "that address does not exist"
 * both surface as a 5xx to be retried five times. The API names the failure —
 * `not_enough_credits` is not `invalid_parameter` — which is what lets the
 * quota case stop the pass instead of burning four more attempts against a
 * limit that will not move until midnight.
 *
 * Free tier: 300 transactional mails a day. `MAIL_DAILY_CAP` keeps the sweeper
 * under that on our side; this file handles the case where Brevo says no
 * anyway — a shared limit, a suspended account, a day's counting that
 * disagrees with ours.
 */
import { getSettingArray } from '@/lib/services/settings';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

import { isAllowedRecipient, mailGuardConfig } from '../mail-guard';

import {
  PermanentChannelError,
  ProviderQuotaError,
  TransientChannelError,
  type ChannelRecipient,
  type NotificationChannel,
  type OutboundNotification,
} from './types';

const log = moduleLogger('brevo-channel');

export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Brevo's own timeout is generous; the sweeper's batch slot is not. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Error codes that mean "no more mail today", not "this message was wrong".
 *
 * Brevo returns these with a 4xx, which under the ordinary rule would be
 * permanent — and permanent is the one thing they are not. The row must stay
 * PENDING so it goes out after the limit resets, which is why they are lifted
 * out of the 4xx branch rather than left to it.
 */
const QUOTA_CODES = new Set([
  'not_enough_credits',
  'too_many_requests',
  'reseller_permission_denied',
]);

interface BrevoErrorBody {
  code?: string;
  message?: string;
}

/** Splits `MAIL_FROM` when it carries a display name, as nodemailer's does. */
export function parseSender(
  mailFrom: string,
  fallbackName: string,
): {
  email: string;
  name: string;
} {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(mailFrom);

  if (angled) {
    return {
      email: angled[2].trim(),
      name: angled[1].replace(/^"|"$/g, '').trim() || fallbackName,
    };
  }

  return { email: mailFrom.trim(), name: fallbackName };
}

/**
 * Turns a Brevo response into the error the sweeper already knows how to act
 * on. Exported for its unit test: this mapping is the whole adapter.
 *
 *   429, or a 4xx naming a quota code  →  ProviderQuotaError, pass stops
 *   other 4xx                          →  PermanentChannelError, no retry
 *   5xx and transport                  →  TransientChannelError, backoff
 */
export function classifyBrevoResponse(status: number, body: BrevoErrorBody | null): Error {
  const code = body?.code ?? '';
  const message = body?.message ?? `Brevo returned ${status}`;

  if (status === 429 || (status >= 400 && status < 500 && QUOTA_CODES.has(code))) {
    return new ProviderQuotaError(`Brevo daily quota reached (${code || status}): ${message}`);
  }

  if (status >= 400 && status < 500) {
    return new PermanentChannelError(`Brevo rejected the message (${code || status}): ${message}`);
  }

  return new TransientChannelError(`Brevo is unavailable (${status}): ${message}`);
}

/** Types the MD and their deputies receive, which the CC list applies to. */
const MD_FACING = new Set(['OVERDUE_MD', 'PROBLEM_RAISED', 'DAILY_DIGEST_MD', 'JOB_COMPLETED']);

/**
 * The extra addresses copied on MD-facing mail (SDD 3.4), allowlist applied.
 *
 * The allowlist check in the dispatcher sees the *recipient*, and knows
 * nothing about a CC list that is loaded here, from an operator-editable
 * setting. Without this filter, adding an address on the settings screen would
 * put mail in front of it that the guard was specifically holding back — and
 * the setting is exactly where somebody would add an address to "just check
 * something". The guard has to hold for every address on the message, not the
 * one in the `to` field.
 */
async function allowedCc(type: string): Promise<string[]> {
  if (!MD_FACING.has(type)) return [];

  const configured = await getSettingArray<string>('mail.md_recipients', []);
  if (configured.length === 0) return [];

  const { allowlist } = mailGuardConfig();
  const permitted = configured.filter((address) => isAllowedRecipient(address, allowlist));

  if (permitted.length !== configured.length) {
    log.info(
      { type, configured: configured.length, permitted: permitted.length },
      'dropped CC addresses that are not on the allowlist',
    );
  }

  return permitted;
}

export const brevoChannel: NotificationChannel = {
  key: 'EMAIL',

  async send(notification: OutboundNotification, user: ChannelRecipient) {
    if (!user.email) {
      throw new PermanentChannelError(`${user.name} has no email address.`);
    }

    const config = env();
    const apiKey = config.BREVO_API_KEY;

    if (!apiKey) {
      // Configuration, not delivery. Permanent, so it surfaces on the first
      // row rather than after five attempts each on the whole batch.
      throw new PermanentChannelError(
        'MAIL_PROVIDER=brevo but BREVO_API_KEY is not set. See docs/MAIL_SETUP.md.',
      );
    }

    const sender = parseSender(config.MAIL_FROM, config.MAIL_FROM_NAME);
    const cc = await allowedCc(notification.type);

    const payload = {
      sender,
      to: [{ email: user.email, name: user.name }],
      ...(cc.length > 0 ? { cc: cc.map((email) => ({ email })) } : {}),
      subject: notification.subject,
      textContent: notification.body,
      ...(notification.html ? { htmlContent: notification.html } : {}),
      headers: {
        // Lets a reply or a bounce be traced back to the exact row.
        'X-JTAS-Notification': notification.id,
        'X-JTAS-Type': notification.type,
      },
    };

    let response: Response;

    try {
      response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A refused connection or a timeout is worth retrying; the sweeper's
      // backoff handles it. Never permanent — the message may yet go.
      throw new TransientChannelError(
        `Brevo could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      let body: BrevoErrorBody | null = null;
      try {
        body = (await response.json()) as BrevoErrorBody;
      } catch {
        // A non-JSON error body is itself informative enough via the status.
      }

      const error = classifyBrevoResponse(response.status, body);

      log.warn(
        {
          notificationId: notification.id,
          status: response.status,
          code: body?.code,
          retryable: !(error instanceof PermanentChannelError),
        },
        'brevo rejected a message',
      );

      throw error;
    }

    const result = (await response.json().catch(() => ({}))) as { messageId?: string };

    log.debug(
      { notificationId: notification.id, messageId: result.messageId },
      'mail accepted by brevo',
    );

    return { providerId: result.messageId };
  },
};

/** What the adapter would send from, for the settings screen and the docs. */
export function brevoSender(): { email: string; name: string } {
  const config = env();
  return parseSender(config.MAIL_FROM, config.MAIL_FROM_NAME);
}
