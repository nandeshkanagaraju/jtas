import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { appRedirectUrl, safeReturnPath } from '@/lib/auth/redirect-url';
import { GET } from '@/app/api/auth/refresh/route';
import { middleware } from '@/middleware';

const auth = vi.hoisted(() => ({ token: undefined as string | undefined, rotate: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (auth.token ? { value: auth.token } : undefined) }),
}));
vi.mock('@/lib/services/auth', () => ({ rotateRefreshToken: auth.rotate }));
vi.mock('@/lib/auth/jwt', () => ({ ACCESS_TTL_SECONDS: 900, verifyAccessToken: async () => null }));
const publicOrigin = 'https://13-127-170-245.sslip.io';
const internal = 'http://0.0.0.0:3000';
beforeEach(() => {
  vi.stubEnv('APP_BASE_URL', publicOrigin);
  auth.token = undefined;
  auth.rotate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('startup redirects behind the production proxy', () => {
  it('returns a missing session to the public login instead of the container', async () => {
    const response = await GET(new Request(`${internal}/api/auth/refresh`));
    expect(response.headers.get('location')).toBe(`${publicOrigin}/login`);
    expect(response.cookies.get('jtas_at')?.value).toBe('');
    expect(response.cookies.get('jtas_rt')?.value).toBe('');
  });
  it('rotates an expired access session and retains the deep link on the first navigation', async () => {
    auth.token = 'valid-refresh';
    auth.rotate.mockResolvedValue({
      tokens: { accessToken: 'new-access', refreshToken: 'new-refresh', refreshTtlSeconds: 43200 },
    });
    const next = '/updates?job=test-job';
    const response = await GET(
      new Request(`${internal}/api/auth/refresh?next=${encodeURIComponent(next)}`),
    );
    expect(response.headers.get('location')).toBe(`${publicOrigin}${next}`);
    expect(response.cookies.get('jtas_at')?.value).toBe('new-access');
    expect(response.cookies.get('jtas_rt')?.value).toBe('new-refresh');
  });
  it('clears a rejected session and reaches public login without a second app launch', async () => {
    auth.token = 'expired-refresh';
    auth.rotate.mockRejectedValue(new Error('Expired'));
    const response = await GET(new Request(`${internal}/api/auth/refresh?next=%2Fmy-tasks`));
    expect(response.headers.get('location')).toBe(`${publicOrigin}/login?next=%2Fmy-tasks`);
    expect(response.cookies.get('jtas_rt')?.value).toBe('');
  });
  it.each(['https://other.invalid/path', '//other.invalid/path', '/\\other.invalid/path'])(
    'keeps an external return destination inside the app: %s',
    async (next) => {
      auth.token = 'valid-refresh';
      auth.rotate.mockResolvedValue({
        tokens: { accessToken: 'a', refreshToken: 'r', refreshTtlSeconds: 43200 },
      });
      const response = await GET(
        new Request(`${internal}/api/auth/refresh?next=${encodeURIComponent(next)}`),
      );
      expect(response.headers.get('location')).toBe(publicOrigin + '/');
    },
  );
  it('uses the public origin for the middleware refresh handoff as well', async () => {
    const request = new NextRequest(`${internal}/updates?job=test-job`, {
      headers: { cookie: 'jtas_rt=refresh', 'x-forwarded-host': 'other.invalid' },
    });
    const response = await middleware(request);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe(publicOrigin);
    expect(location.pathname).toBe('/api/auth/refresh');
    expect(location.searchParams.get('next')).toBe('/updates?job=test-job');
  });
  it('uses the request origin for local environments without an explicit app URL', () => {
    vi.stubEnv('APP_BASE_URL', '');
    expect(appRedirectUrl('/login', 'http://localhost:3101/').href).toBe(
      'http://localhost:3101/login',
    );
    expect(safeReturnPath('/tasks/task-1?tab=notes')).toBe('/tasks/task-1?tab=notes');
  });
});
