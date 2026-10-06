/**
 * The only place that speaks the Telegram Bot API.
 *
 * Everything above this file talks in plain text and buttons. A later WhatsApp
 * adapter replaces this file; it does not replace the actions or the services.
 */
import { PermanentChannelError, TransientChannelError } from '@/lib/notifications/channels/types';

export interface TelegramButton {
  text: string;
  callback_data: string;
}

export interface TelegramSend {
  chatId: string;
  text: string;
  buttons?: TelegramButton[][];
}

type Transport = (method: string, body: Record<string, unknown>) => Promise<unknown>;

let transport: Transport | null = null;

/** Test seam. Production uses HTTPS to api.telegram.org. */
export function setTelegramTransport(next: Transport | null): void {
  transport = next;
}

type FileDownload = (fileId: string) => Promise<Uint8Array>;

let fileDownload: FileDownload | null = null;

/** Test seam for the bytes behind a Telegram file id. */
export function setTelegramFileDownload(next: FileDownload | null): void {
  fileDownload = next;
}

/**
 * The bytes of a file Telegram is holding for this bot.
 *
 * `getFile` only works up to 20 MB. A larger file is refused by Telegram
 * before any bytes move; the caller turns that into a reply.
 */
export async function downloadTelegramFile(fileId: string): Promise<Uint8Array> {
  if (fileDownload) return fileDownload(fileId);

  const info = (await telegramApi('getFile', { file_id: fileId })) as {
    file_path?: string;
  } | null;
  const filePath = info?.file_path;
  if (!filePath) {
    throw new PermanentChannelError('Telegram did not return the file.');
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new PermanentChannelError('Telegram is not configured.');
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  } catch (error) {
    throw new TransientChannelError('Telegram could not be reached.', { cause: error });
  }

  if (response.status >= 500 || response.status === 429) {
    throw new TransientChannelError(`Telegram returned ${response.status}.`);
  }
  if (!response.ok) {
    throw new PermanentChannelError(`Telegram rejected the file download (${response.status}).`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export async function telegramApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  if (transport) return transport(method, body);

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new PermanentChannelError('Telegram is not configured.');
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new TransientChannelError('Telegram could not be reached.', { cause: error });
  }

  if (response.status >= 500 || response.status === 429) {
    throw new TransientChannelError(`Telegram returned ${response.status}.`);
  }

  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: unknown;
  } | null;

  if (!response.ok || !payload?.ok) {
    throw new PermanentChannelError(payload?.description ?? `Telegram rejected ${method}.`);
  }

  return payload.result;
}

export async function sendTelegramMessage(message: TelegramSend): Promise<{ message_id?: number }> {
  const result = await telegramApi('sendMessage', {
    chat_id: message.chatId,
    text: message.text,
    ...(message.buttons && message.buttons.length > 0
      ? { reply_markup: { inline_keyboard: message.buttons } }
      : {}),
  });

  const id = (result as { message_id?: number } | null)?.message_id;
  return { message_id: id };
}
