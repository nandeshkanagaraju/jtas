import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  REFRESH_TTL_SECONDS_REMEMBERED,
  hashToken,
  newTokenId,
  requireAccessToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '@/lib/auth/jwt';
import { AppError } from '@/lib/errors';

const ACCESS_SECRET = 'test-access-secret-that-is-at-least-32-chars';
const REFRESH_SECRET = 'test-refresh-secret-that-is-at-least-32-chars';

beforeEach(() => {
  process.env.JWT_SECRET = ACCESS_SECRET;
  process.env.REFRESH_SECRET = REFRESH_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

const claims = {
  sub: 'user-1',
  role: 'MD' as const,
  departmentId: null,
  mustChangePassword: false,
};

describe('access tokens', () => {
  it('round-trips its claims', async () => {
    const token = await signAccessToken(claims);
    await expect(verifyAccessToken(token)).resolves.toEqual(claims);
  });

  it('carries departmentId for a member', async () => {
    const memberClaims = {
      sub: 'user-2',
      role: 'MEMBER' as const,
      departmentId: 'dept-production',
      mustChangePassword: true,
    };
    const token = await signAccessToken(memberClaims);
    await expect(verifyAccessToken(token)).resolves.toEqual(memberClaims);
  });

  it('expires after 15 minutes (SDD 8.2)', async () => {
    expect(ACCESS_TTL_SECONDS).toBe(15 * 60);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));
    const token = await signAccessToken(claims);

    // Still valid one minute before expiry…
    vi.setSystemTime(new Date('2026-09-13T10:14:00Z'));
    await expect(verifyAccessToken(token)).resolves.toEqual(claims);

    // …and rejected a minute after it.
    vi.setSystemTime(new Date('2026-09-13T10:16:00Z'));
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(claims);
    process.env.JWT_SECRET = 'a-completely-different-secret-value-32ch';
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'MD', typ: 'access' }),
    ).toString('base64url');
    await expect(verifyAccessToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects garbage rather than throwing', async () => {
    await expect(verifyAccessToken('not-a-jwt')).resolves.toBeNull();
    await expect(verifyAccessToken('')).resolves.toBeNull();
  });

  it('refuses a refresh token presented as an access token', async () => {
    // Only possible if the two secrets are ever made the same; the typ claim
    // makes that mistake non-exploitable.
    process.env.REFRESH_SECRET = ACCESS_SECRET;
    const refresh = await signRefreshToken({
      sub: 'user-1',
      familyId: 'fam-1',
      jti: 'jti-1',
    });
    await expect(verifyAccessToken(refresh)).resolves.toBeNull();
  });
});

describe('refresh tokens', () => {
  const refreshClaims = { sub: 'user-1', familyId: 'fam-1', jti: 'jti-1' };

  it('round-trips its claims', async () => {
    const token = await signRefreshToken(refreshClaims);
    await expect(verifyRefreshToken(token)).resolves.toEqual(refreshClaims);
  });

  it('defaults to a 12-hour session and extends to 30 days when remembered', async () => {
    expect(REFRESH_TTL_SECONDS).toBe(12 * 60 * 60);
    expect(REFRESH_TTL_SECONDS_REMEMBERED).toBe(30 * 24 * 60 * 60);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-13T10:00:00Z'));

    const session = await signRefreshToken(refreshClaims);
    const remembered = await signRefreshToken(refreshClaims, REFRESH_TTL_SECONDS_REMEMBERED);

    // 13 hours later the plain session token is dead…
    vi.setSystemTime(new Date('2026-09-13T23:00:00Z'));
    await expect(verifyRefreshToken(session)).resolves.toBeNull();
    // …and the remembered one is not.
    await expect(verifyRefreshToken(remembered)).resolves.toEqual(refreshClaims);

    // 31 days later neither is.
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    await expect(verifyRefreshToken(remembered)).resolves.toBeNull();
  });

  it('refuses an access token presented as a refresh token', async () => {
    process.env.JWT_SECRET = REFRESH_SECRET;
    const access = await signAccessToken(claims);
    await expect(verifyRefreshToken(access)).resolves.toBeNull();
  });

  it('rejects a token signed with the access secret', async () => {
    const token = await signRefreshToken(refreshClaims);
    process.env.REFRESH_SECRET = 'yet-another-refresh-secret-value-32chars';
    await expect(verifyRefreshToken(token)).resolves.toBeNull();
  });
});

describe('secret validation', () => {
  it('refuses to sign with a missing or short secret', async () => {
    process.env.JWT_SECRET = 'too-short';
    await expect(signAccessToken(claims)).rejects.toThrow(/shorter than 32 characters/);

    delete process.env.JWT_SECRET;
    await expect(signAccessToken(claims)).rejects.toThrow(/missing or shorter/);
  });
});

describe('requireAccessToken', () => {
  it('returns claims for a valid token', async () => {
    const token = await signAccessToken(claims);
    await expect(requireAccessToken(token)).resolves.toEqual(claims);
  });

  it('throws UNAUTHENTICATED when the token is absent', async () => {
    await expect(requireAccessToken(undefined)).rejects.toBeInstanceOf(AppError);
    await expect(requireAccessToken(undefined)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('throws UNAUTHENTICATED when the token is invalid', async () => {
    await expect(requireAccessToken('nonsense')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

describe('hashToken', () => {
  it('is a stable 64-character hex SHA-256', async () => {
    const hash = await hashToken('some-refresh-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(hashToken('some-refresh-token')).resolves.toBe(hash);
  });

  it('differs for different tokens', async () => {
    const [a, b] = await Promise.all([hashToken('token-a'), hashToken('token-b')]);
    expect(a).not.toBe(b);
  });

  it('never contains the token itself, so a leaked backup is useless', async () => {
    const token = 'a-very-secret-refresh-token';
    await expect(hashToken(token)).resolves.not.toContain(token);
  });
});

describe('newTokenId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTokenId()));
    expect(ids.size).toBe(100);
  });
});
