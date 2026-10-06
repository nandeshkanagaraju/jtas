/**
 * The signed-in person's own Telegram link.
 *
 * POST issues a one-time code. DELETE forgets the chat id. Neither route
 * accepts a chat id from the browser — that arrives only through the bot.
 */
import { handler, noContent, ok } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { issueLinkCode, unlinkTelegram } from '@/lib/telegram/link';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  const session = await requireActiveSession();
  const issued = await issueLinkCode(session.id);
  return ok({
    code: issued.code,
    expiresAt: issued.expiresAt.toISOString(),
    botUsername: process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '') || null,
  });
});

export const DELETE = handler(async (request) => {
  const session = await requireActiveSession();
  await unlinkTelegram(session.id, clientIp(request));
  return noContent();
});
