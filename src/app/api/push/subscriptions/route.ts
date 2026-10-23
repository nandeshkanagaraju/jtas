import { createHash } from 'node:crypto';
import { handler, noContent, ok, parseJson } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { conflict, forbidden } from '@/lib/errors';
import { pushConfig } from '@/lib/push/config';
import { pushSessionFamily, requireSameOrigin } from '@/lib/push/subscriptions';
import { endpointSchema, subscriptionSchema } from '@/lib/push/validation';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const user = await requireActiveSession();
  const family = await pushSessionFamily(user.id);
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: user.id, sessionFamilyId: family },
    select: { endpoint: true },
  });
  return ok({
    publicKey: pushConfig()?.publicKey ?? null,
    endpointHashes: subscriptions.map(({ endpoint }) =>
      createHash('sha256').update(endpoint).digest('hex'),
    ),
  });
});

export const POST = handler(async (request) => {
  requireSameOrigin(request);
  const user = await requireActiveSession();
  if (!pushConfig()) throw conflict('Push notifications are not configured yet.');
  if (await prisma.user.count({ where: { id: user.id, isDemo: true } })) throw forbidden();
  const input = await parseJson(request, subscriptionSchema);
  const sessionFamilyId = await pushSessionFamily(user.id);
  const data = { userId: user.id, sessionFamilyId, locale: input.locale, ...input.keys };
  // A browser endpoint has one owner. Explicit enable rebinds a shared device.
  await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...data },
    update: data,
  });
  return noContent();
});

export const DELETE = handler(async (request) => {
  requireSameOrigin(request);
  const user = await requireActiveSession();
  const input = await parseJson(request, z.object({ endpoint: endpointSchema }));
  await prisma.pushSubscription.deleteMany({
    where: { userId: user.id, endpoint: input.endpoint },
  });
  return noContent();
});

export const PATCH = handler(async (request) => {
  requireSameOrigin(request);
  const user = await requireActiveSession();
  const family = await pushSessionFamily(user.id);
  const input = await parseJson(
    request,
    z.object({ endpoint: endpointSchema, locale: z.enum(['en', 'ta', 'hi']) }),
  );
  await prisma.pushSubscription.updateMany({
    where: { endpoint: input.endpoint, userId: user.id, sessionFamilyId: family },
    data: { locale: input.locale },
  });
  return noContent();
});
