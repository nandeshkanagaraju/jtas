/**
 * Session cookie handling (SDD section 8.2 and 8.3).
 *
 * Both tokens live in httpOnly cookies so that no script — including an
 * injected one — can read them. `SameSite=Lax` blocks cross-site POSTs while
 * still allowing a user to follow a deep link from a notification email
 * straight into an authenticated page, which is the whole point of improvement
 * I-14.
 */
import type { NextResponse } from 'next/server';

import { ACCESS_TTL_SECONDS } from './jwt';

export const ACCESS_COOKIE = 'jtas_at';
export const REFRESH_COOKIE = 'jtas_rt';

/**
 * `Secure` is omitted in development because localhost is plain HTTP and the
 * browser would silently drop the cookie. Production is HTTPS-only with HSTS.
 */
function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

/** Attaches a freshly minted pair of tokens to a response. */
export function setSessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string; refreshTtlSeconds: number },
): NextResponse {
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    ...baseCookieOptions(),
    maxAge: ACCESS_TTL_SECONDS,
  });

  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseCookieOptions(),
    maxAge: tokens.refreshTtlSeconds,
  });

  return response;
}

/**
 * Clears both cookies.
 *
 * `maxAge: 0` with the same attributes is what actually removes them — a
 * mismatched `path` or `sameSite` would leave the original cookie in place and
 * the user apparently signed in after logging out.
 */
export function clearSessionCookies(response: NextResponse): NextResponse {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    response.cookies.set(name, '', { ...baseCookieOptions(), maxAge: 0 });
  }
  return response;
}
