/**
 * POST|GET /api/auth/refresh — refresh-token rotation (SDD section 8.2).
 *
 * Not listed in the SDD section 6.2 endpoint table, but rotation is mandated by
 * section 8.2 and needs somewhere to happen. Two shapes:
 *
 *   POST — for a client fetch wrapper retrying after a 401. Returns JSON.
 *   GET  — for the middleware redirect on a page navigation, where the access
 *          token has expired but the refresh token is still good. Returns a
 *          redirect to `?next=`, so the user never sees a login screen they did
 *          not need.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from '@/lib/auth/cookies';
import { handler } from '@/lib/api/respond';
import { rotateRefreshToken } from '@/lib/services/auth';
import { unauthenticated } from '@/lib/errors';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (request) => {
  const token = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!token) throw unauthenticated();

  const { user, tokens } = await rotateRefreshToken(token, { ipAddress: clientIp(request) });

  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId,
      mustChangePassword: user.mustChangePassword,
    },
  });

  return setSessionCookies(response, tokens);
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Only a same-origin path is honoured, so `?next=` cannot be used as an open
  // redirect into someone else's site.
  const rawNext = url.searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const token = (await cookies()).get(REFRESH_COOKIE)?.value;

  if (!token) {
    return clearSessionCookies(NextResponse.redirect(new URL('/login', url.origin)));
  }

  try {
    const { tokens } = await rotateRefreshToken(token, { ipAddress: clientIp(request) });
    return setSessionCookies(NextResponse.redirect(new URL(next, url.origin)), tokens);
  } catch {
    // Rotation failed — expired, revoked, or reuse detected. Either way the
    // session is over; clear the cookies so middleware does not loop back here.
    const response = NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, url.origin),
    );
    return clearSessionCookies(response);
  }
}
