/**
 * FR-03: a user who still owes a password change may reach `/change-password`
 * and sign out. Nothing else.
 *
 * Two gates enforce it, and both are checked here because each covers what the
 * other cannot:
 *
 *   middleware              pages — redirects to /change-password
 *   requireActiveSession    API   — 403, because `/api/*` is deliberately
 *                                   outside the middleware matcher (an API
 *                                   client needs a JSON envelope, not a
 *                                   redirect to an HTML login page)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { signAccessToken } from '@/lib/auth/jwt';
import { middleware } from '@/middleware';

import { createTestUser, resetAuthTables, testDb } from './helpers/db';

/** Pages a member or MD would otherwise be entitled to open. */
const GUARDED_PAGES = ['/dashboard', '/my-tasks', '/jobs', '/problems', '/users'];

async function tokenFor(user: { id: string; role: string; departmentId: string | null }) {
  return signAccessToken({
    sub: user.id,
    role: user.role as 'MD',
    departmentId: user.departmentId,
    mustChangePassword: true,
  });
}

function request(path: string, token: string) {
  const req = new NextRequest(new URL(path, 'http://localhost:3000'));
  req.cookies.set(ACCESS_COOKIE, token);
  return req;
}

beforeEach(async () => {
  await resetAuthTables();
  vi.resetModules();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('middleware — the page side', () => {
  it.each(GUARDED_PAGES)('redirects %s to /change-password', async (path) => {
    const user = await createTestUser({ mustChangePassword: true });
    const response = await middleware(request(path, await tokenFor(user)));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/change-password');
  });

  it('lets /change-password itself through', async () => {
    const user = await createTestUser({ mustChangePassword: true });
    const response = await middleware(request('/change-password', await tokenFor(user)));

    // Not a redirect: this is the one page the user is meant to reach.
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it('bounces /login to /change-password rather than to the role landing page', async () => {
    const user = await createTestUser({ mustChangePassword: true });
    const response = await middleware(request('/login', await tokenFor(user)));

    expect(new URL(response.headers.get('location')!).pathname).toBe('/change-password');
  });

  it('sends the same user to their landing page once the flag clears', async () => {
    const user = await createTestUser({ role: 'MEMBER', mustChangePassword: false });
    const token = await signAccessToken({
      sub: user.id,
      role: 'MEMBER',
      departmentId: user.departmentId,
      mustChangePassword: false,
    });

    const response = await middleware(request('/my-tasks', token));
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('requireActiveSession — the API side', () => {
  it('refuses a user who owes a password change, and names why', async () => {
    const user = await createTestUser({ mustChangePassword: true });
    const token = await tokenFor(user);

    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) => (name === ACCESS_COOKIE ? { value: token } : undefined),
      }),
    }));

    const { requireActiveSession, requireAuth } = await import('@/lib/auth/session');

    await expect(requireActiveSession()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    // requireAuth still resolves — it is what /api/auth/change-password and
    // /api/auth/me use, and blocking those would leave no way out.
    await expect(requireAuth()).resolves.toMatchObject({ id: user.id });
  });

  it('allows the same session once the flag is cleared', async () => {
    const user = await createTestUser({ mustChangePassword: false });
    const token = await signAccessToken({
      sub: user.id,
      role: 'MEMBER',
      departmentId: user.departmentId,
      mustChangePassword: false,
    });

    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) => (name === ACCESS_COOKIE ? { value: token } : undefined),
      }),
    }));

    const { requireActiveSession } = await import('@/lib/auth/session');
    await expect(requireActiveSession()).resolves.toMatchObject({ id: user.id });
  });

  it('reads the flag from the database, not from the token', async () => {
    // A token minted before the change still says false. The authoritative row
    // is what decides, so an administrator forcing a reset takes effect on the
    // next request rather than in fifteen minutes.
    const user = await createTestUser({ mustChangePassword: true });
    const staleToken = await signAccessToken({
      sub: user.id,
      role: 'MEMBER',
      departmentId: user.departmentId,
      mustChangePassword: false,
    });

    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) => (name === ACCESS_COOKIE ? { value: staleToken } : undefined),
      }),
    }));

    const { requireActiveSession } = await import('@/lib/auth/session');
    await expect(requireActiveSession()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('every API route is behind the gate', () => {
  /**
   * The routes that must NOT require a completed password change, with the
   * reason each is exempt. Anything else missing the guard is a bug: a new
   * endpoint that forgets it is reachable by a user who owes a change.
   */
  const EXEMPT: Record<string, string> = {
    'auth/login/route.ts': 'issues the session in the first place',
    'auth/logout/route.ts': 'signing out must never be blocked',
    'auth/refresh/route.ts': 'rotates the token, no user action',
    'auth/me/route.ts': 'the client reads the flag from here',
    'auth/change-password/route.ts': 'the way out',
    'health/route.ts': 'unauthenticated uptime check',
    'dev/preview-email/route.ts': 'development only, 404 in production',
    // Telegram has no session. The route rejects any call that does not carry
    // the webhook secret set when the bot was registered.
    'telegram/webhook/route.ts': 'authenticated by the webhook secret, not a session',
  };

  function routeFiles(dir: string, prefix = ''): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}${entry}/`);
      return entry === 'route.ts' ? [`${prefix}${entry}`] : [];
    });
  }

  const API_DIR = join(process.cwd(), 'src/app/api');

  it('finds every route file', () => {
    expect(routeFiles(API_DIR).length).toBeGreaterThan(20);
  });

  it.each(routeFiles(API_DIR))('%s requires an active session', (relative) => {
    if (relative in EXEMPT) return;

    const source = readFileSync(join(API_DIR, relative), 'utf8');

    // Either the handler calls it directly, or it delegates to a shared
    // handler in this tree that does.
    const guarded =
      source.includes('requireActiveSession') ||
      source.includes('lifecycle-handler') ||
      source.includes('problem-action');

    expect(guarded, `${relative} does not require an active session`).toBe(true);
  });

  it('exempts nothing that no longer exists', () => {
    const present = new Set(routeFiles(API_DIR));
    for (const relative of Object.keys(EXEMPT)) {
      expect(present.has(relative), `${relative} is exempted but gone`).toBe(true);
    }
  });
});
