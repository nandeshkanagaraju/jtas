import crypto from 'node:crypto';

/**
 * Compares the webhook secret Telegram sends back on every update.
 *
 * A length mismatch returns false without throwing. The token itself never
 * leaves the server environment.
 */
export function webhookAuthorized(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';
  const got = header ?? '';
  if (!expected || !got) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
