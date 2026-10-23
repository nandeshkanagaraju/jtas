import { cookies } from 'next/headers';
import { REFRESH_COOKIE } from '@/lib/auth/cookies';
import { verifyRefreshToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { forbidden, unauthenticated } from '@/lib/errors';

export async function pushSessionFamily(userId: string) {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value;
  const claims = token ? await verifyRefreshToken(token) : null;
  if (!claims || claims.sub !== userId) throw unauthenticated();
  const active = await prisma.refreshToken.findFirst({
    where: { userId, familyId: claims.familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!active) throw unauthenticated();
  return claims.familyId;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = process.env.APP_BASE_URL;
  if (!origin || !expected || origin !== new URL(expected).origin) throw forbidden();
}
