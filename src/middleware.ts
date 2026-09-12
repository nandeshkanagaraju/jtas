/**
 * Route protection at the door (build spec M1.7).
 *
 * Runs on the edge runtime, so it is limited to what a stateless JWT check can
 * decide: is there a session, does the user still owe a password change, and
 * where should each role land. It deliberately does **not** make authorisation
 * decisions — those need the authoritative database record and go through
 * `can()` inside the page or route handler (architecture rule 3). A member who
 * types `/dashboard` is allowed past middleware and receives a real 403 from
 * the page, rather than a redirect that hides the refusal.
 *
 * `/api/*` is excluded entirely: an API client needs a 401 envelope, not a
 * redirect to an HTML login page.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/auth/cookies';
import { verifyAccessToken, type AccessClaims } from '@/lib/auth/jwt';
import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp';

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(['/login']);

/** The only page a user who owes a password change may open. */
const CHANGE_PASSWORD_PATH = '/change-password';

/** Where each role starts (build spec M1.7). */
function landingPath(role: AccessClaims['role']): string {
  switch (role) {
    case 'MD':
    case 'DEPUTY_MD':
      return '/dashboard';
    case 'ADMIN':
      return '/users';
    case 'MEMBER':
      return '/my-tasks';
  }
}

function redirect(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  /*
   * The nonce has to reach two places: the *request*, where Next reads it and
   * stamps it onto every script tag it emits, and the *response*, where the
   * browser reads it back to decide which scripts may run. Miss either and the
   * page renders but never hydrates.
   */
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  /** Attaches the policy to whatever response this request produces. */
  const withCsp = (response: NextResponse): NextResponse => {
    response.headers.set('Content-Security-Policy', csp);
    return response;
  };

  const proceed = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const claims = accessToken ? await verifyAccessToken(accessToken) : null;

  // --- Public pages -------------------------------------------------------
  if (PUBLIC_PATHS.has(pathname)) {
    // Someone already signed in has no use for the login screen.
    if (claims) {
      return withCsp(
        redirect(
          request,
          claims.mustChangePassword ? CHANGE_PASSWORD_PATH : landingPath(claims.role),
        ),
      );
    }
    return proceed();
  }

  // --- No usable access token --------------------------------------------
  if (!claims) {
    // An expired access token with a live refresh token is the ordinary case
    // after 15 minutes. Rotate silently and come back, so the user never sees
    // a login screen they did not need. Middleware cannot do this itself — it
    // has no database — so it hands off to the Node-runtime refresh route.
    if (request.cookies.has(REFRESH_COOKIE)) {
      const target = new URL('/api/auth/refresh', request.nextUrl.origin);
      target.searchParams.set('next', `${pathname}${search}`);
      return withCsp(NextResponse.redirect(target));
    }

    const login = new URL('/login', request.nextUrl.origin);
    // Remember where they were headed, so the deep link from a notification
    // email survives the detour (improvement I-14).
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    return withCsp(NextResponse.redirect(login));
  }

  // --- Forced password change (FR-03) ------------------------------------
  if (claims.mustChangePassword && pathname !== CHANGE_PASSWORD_PATH) {
    return withCsp(redirect(request, CHANGE_PASSWORD_PATH));
  }

  // --- Role landing -------------------------------------------------------
  if (pathname === '/') {
    return withCsp(redirect(request, landingPath(claims.role)));
  }

  return proceed();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api        — handlers return JSON envelopes, not redirects
     *   _next/*    — framework assets
     *   static files — anything with a file extension
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
};
