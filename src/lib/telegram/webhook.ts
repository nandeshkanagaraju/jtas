/**
 * Registers the webhook once, when the worker boots.
 *
 * A webhook, rather than long polling: the site is already on HTTPS, so
 * Telegram can POST an update the moment a button is pressed. Polling would
 * live inside the worker and go quiet for the whole of a restart. The secret
 * is checked on every request, so the public path is not an open door.
 *
 * Skipped when the token is absent, or when the base URL is not https — local
 * development has nothing Telegram can reach.
 */
import { moduleLogger } from '@/lib/utils/logger';

import { telegramApi, telegramConfigured } from './api';

const log = moduleLogger('telegram');

export async function ensureTelegramWebhook(): Promise<void> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');

  if (!telegramConfigured() || !secret || !base?.startsWith('https://')) {
    log.info('telegram webhook left unset');
    return;
  }

  const url = `${base}/api/telegram/webhook`;
  await telegramApi('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });
  log.info({ url }, 'telegram webhook registered');
}
