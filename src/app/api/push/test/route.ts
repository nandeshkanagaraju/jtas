import webpush from 'web-push';
import { z } from 'zod';
import { handler, ok, parseJson } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { rateLimiter } from '@/lib/auth/rate-limit';
import { prisma } from '@/lib/db/prisma';
import { conflict, rateLimited } from '@/lib/errors';
import { pushConfig } from '@/lib/push/config';
import { requireSameOrigin, pushSessionFamily } from '@/lib/push/subscriptions';
import { endpointSchema } from '@/lib/push/validation';

export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const user = await requireActiveSession();
  const limit = await rateLimiter.hit(`push-test:${user.id}`, 3, 60);
  if (!limit.allowed)
    throw rateLimited('Please wait before sending another test.', limit.retryAfterSeconds);
  const input = await parseJson(request, z.object({ endpoint: endpointSchema }));
  const family = await pushSessionFamily(user.id);
  const subscription = await prisma.pushSubscription.findFirst({
    where: { userId: user.id, endpoint: input.endpoint, sessionFamilyId: family },
  });
  const config = pushConfig();
  if (!subscription || !config) throw conflict('Enable push notifications on this device first.');
  const index = subscription.locale === 'ta' ? 1 : subscription.locale === 'hi' ? 2 : 0;
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({
        title: ['Jaraa · Test notification', 'Jaraa · சோதனை அறிவிப்பு', 'Jaraa · परीक्षण सूचना'][
          index
        ],
        body: [
          'Push notifications are working on this device.',
          'இந்தச் சாதனத்தில் புஷ் அறிவிப்புகள் செயல்படுகின்றன.',
          'इस डिवाइस पर पुश सूचनाएँ काम कर रही हैं।',
        ][index],
        lang: subscription.locale,
        url: '/account#push',
        tag: 'jaraa-push-test',
      }),
      { vapidDetails: config, TTL: 60, timeout: 10_000 },
    );
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410)
      await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
    throw conflict('The test could not be delivered. Try enabling notifications again.');
  }
  return ok({ sent: true });
});
