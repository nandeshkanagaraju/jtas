/**
 * Telegram delivery. The row is already rendered to short text by the sweeper.
 * This only hands it to the bot API, with buttons when the event has any.
 */
import { PermanentChannelError, type NotificationChannel } from './types';
import { sendTelegramMessage } from '@/lib/telegram/api';

export const telegramChannel: NotificationChannel = {
  key: 'TELEGRAM',
  async send(notification, user) {
    if (!user.telegramChatId) {
      throw new PermanentChannelError('No Telegram chat is linked.');
    }

    if (notification.preface?.trim()) {
      await sendTelegramMessage({
        chatId: user.telegramChatId,
        text: notification.preface,
      });
    }

    const sent = await sendTelegramMessage({
      chatId: user.telegramChatId,
      text: notification.body,
      buttons: notification.actions?.map((row) =>
        row.map((action) => ({ text: action.label, callback_data: action.data })),
      ),
    });

    return { providerId: sent.message_id ? String(sent.message_id) : undefined };
  },
};
