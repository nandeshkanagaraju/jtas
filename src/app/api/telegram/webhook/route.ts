/**
 * POST /api/telegram/webhook — updates from Telegram, and from nowhere else.
 *
 * The secret header is set when the worker registers the webhook. A request
 * without it is rejected before any chat id is looked up.
 */
import { NextResponse } from 'next/server';

import { handleTelegramUpdate, type TelegramUpdate } from '@/lib/telegram/handle-update';
import { webhookAuthorized } from '@/lib/telegram/secret';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!webhookAuthorized(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return new NextResponse(null, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  if (update && typeof update === 'object') {
    await handleTelegramUpdate(update);
  }

  return NextResponse.json({ ok: true });
}
