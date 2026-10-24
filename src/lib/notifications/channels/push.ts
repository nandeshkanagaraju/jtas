import webpush from 'web-push';
import { prisma } from '@/lib/db/prisma';
import { pushConfig } from '@/lib/push/config';
import { inboxLinkFor } from '../inbox-links';
import { PermanentChannelError, TransientChannelError, type NotificationChannel } from './types';
import { pushMessage } from '@/lib/push/messages';

export const pushChannel: NotificationChannel = {
  key: 'PUSH',
  async send(notification, user) {
    const config = pushConfig();
    if (!config) throw new PermanentChannelError('Push notifications are not configured.');
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    let retry = false;
    for (const subscription of subscriptions) {
      const active = await prisma.refreshToken.findFirst({
        where: {
          userId: user.id,
          familyId: subscription.sessionFamilyId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!active) {
        await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
        continue;
      }
      const delivered = await prisma.pushDelivery.findUnique({
        where: {
          notificationId_subscriptionId: {
            notificationId: notification.id,
            subscriptionId: subscription.id,
          },
        },
      });
      if (delivered) continue;
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { auth: subscription.auth, p256dh: subscription.p256dh },
          },
          JSON.stringify({
            ...pushMessage(notification, subscription.locale),
            url: inboxLinkFor(notification),
            tag: notification.id,
          }),
          { vapidDetails: config, TTL: 86_400, urgency: 'high', timeout: 10_000 },
        );
        await prisma.pushDelivery.upsert({
          where: {
            notificationId_subscriptionId: {
              notificationId: notification.id,
              subscriptionId: subscription.id,
            },
          },
          create: { notificationId: notification.id, subscriptionId: subscription.id },
          update: {},
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
        } else {
          // Do not persist provider errors: they can contain subscription URLs.
          retry = true;
        }
      }
    }
    if (retry) throw new TransientChannelError('A push service is temporarily unavailable.');
    return {};
  },
};
