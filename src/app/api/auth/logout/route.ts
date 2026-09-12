/**
 * POST /api/auth/logout — SDD section 6.2.
 *
 * Always returns 204, even without a valid session: a sign-out that can fail
 * would leave a user stuck on a shared terminal.
 */
import { NextResponse } from 'next/server';

import { REFRESH_COOKIE, clearSessionCookies } from '@/lib/auth/cookies';
import { handler } from '@/lib/api/respond';
import { logout } from '@/lib/services/auth-service';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const { cookies } = await import('next/headers');
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;

  await logout(refreshToken, { ipAddress: clientIp(request) });

  const response = new NextResponse(null, { status: 204 });
  return clearSessionCookies(response);
});
