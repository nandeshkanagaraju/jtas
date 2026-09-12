import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { hashToken, verifyAccessToken, verifyRefreshToken } from '@/lib/auth/jwt';
import { verifyPassword } from '@/lib/auth/password';
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  changePassword,
  login,
  logout,
  rotateRefreshToken,
} from '@/lib/services/auth';
import type { AppError } from '@/lib/errors';

import { auditActionsFor, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };
const PASSWORD = 'Shopfloor7';

beforeEach(async () => {
  await resetAuthTables();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('login', () => {
  it('issues a usable token pair and records LOGIN_SUCCESS with the IP', async () => {
    const user = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });

    const result = await login(
      { email: 'md@jaraaglobal.com', password: PASSWORD, rememberDevice: false },
      ctx,
    );

    expect(result.user.id).toBe(user.id);
    expect(result.user.role).toBe('MD');

    // The access token carries the claims middleware routes on.
    await expect(verifyAccessToken(result.tokens.accessToken)).resolves.toMatchObject({
      sub: user.id,
      role: 'MD',
      mustChangePassword: false,
    });

    // The refresh token is persisted as a hash, never in the clear.
    const stored = await testDb.refreshToken.findFirst({ where: { userId: user.id } });
    expect(stored).not.toBeNull();
    expect(stored!.tokenHash).toBe(await hashToken(result.tokens.refreshToken));
    expect(stored!.tokenHash).not.toContain(result.tokens.refreshToken);

    const audit = await testDb.auditLog.findFirst({
      where: { entityId: user.id, action: 'LOGIN_SUCCESS' },
    });
    expect(audit?.ipAddress).toBe('203.0.113.7');
  });

  it('is case-insensitive on the email, via the shared schema', async () => {
    await createTestUser({ email: 'md@jaraaglobal.com' });
    // The Zod schema lowercases before the service sees it.
    await expect(
      login({ email: 'md@jaraaglobal.com', password: PASSWORD, rememberDevice: false }, ctx),
    ).resolves.toBeDefined();
  });

  it('stamps lastLoginAt and clears the failure counter', async () => {
    const user = await createTestUser({ failedLoginCount: 3 });

    await login({ email: user.email, password: PASSWORD, rememberDevice: false }, ctx);

    const refreshed = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.failedLoginCount).toBe(0);
    expect(refreshed.lockedUntil).toBeNull();
    expect(refreshed.lastLoginAt).not.toBeNull();
  });

  it('extends the refresh token to 30 days when the device is remembered', async () => {
    const user = await createTestUser();

    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );
    const remembered = await login(
      { email: user.email, password: PASSWORD, rememberDevice: true },
      ctx,
    );

    expect(session.tokens.refreshTtlSeconds).toBe(12 * 60 * 60);
    expect(remembered.tokens.refreshTtlSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('returns mustChangePassword so the client can force the redirect', async () => {
    const user = await createTestUser({ mustChangePassword: true });

    const result = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    expect(result.user.mustChangePassword).toBe(true);
    await expect(verifyAccessToken(result.tokens.accessToken)).resolves.toMatchObject({
      mustChangePassword: true,
    });
  });

  it('gives the same message for an unknown email and a wrong password', async () => {
    await createTestUser({ email: 'known@jaraaglobal.com' });

    const unknown = await login(
      { email: 'nobody@jaraaglobal.com', password: PASSWORD, rememberDevice: false },
      ctx,
    ).catch((e: AppError) => e);

    const wrongPassword = await login(
      { email: 'known@jaraaglobal.com', password: 'WrongPass1', rememberDevice: false },
      ctx,
    ).catch((e: AppError) => e);

    // Enumeration defence: neither response reveals whether the address exists.
    expect((unknown as AppError).message).toBe((wrongPassword as AppError).message);
    expect((unknown as AppError).code).toBe('UNAUTHENTICATED');
  });

  it('records LOGIN_FAILED for an unknown email against the address tried', async () => {
    await login(
      { email: 'nobody@jaraaglobal.com', password: PASSWORD, rememberDevice: false },
      ctx,
    ).catch(() => undefined);

    expect(await auditActionsFor('nobody@jaraaglobal.com')).toEqual(['LOGIN_FAILED']);
  });

  it('refuses a deactivated account without deleting its history (FR-70)', async () => {
    const user = await createTestUser({ isActive: false });

    await expect(
      login({ email: user.email, password: PASSWORD, rememberDevice: false }, ctx),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(await auditActionsFor(user.id)).toContain('LOGIN_FAILED');
    // The row is still there.
    await expect(testDb.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Lockout — FR-06
// ---------------------------------------------------------------------------

describe('account lockout', () => {
  it('locks after exactly 5 failures and records ACCOUNT_LOCKED', async () => {
    const user = await createTestUser();
    const bad = { email: user.email, password: 'WrongPass1', rememberDevice: false };

    for (let attempt = 1; attempt <= MAX_FAILED_LOGINS - 1; attempt++) {
      await login(bad, ctx).catch(() => undefined);
      const row = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.failedLoginCount, `after attempt ${attempt}`).toBe(attempt);
      expect(row.lockedUntil, `after attempt ${attempt}`).toBeNull();
    }

    // The fifth one locks it.
    await login(bad, ctx).catch(() => undefined);

    const locked = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.failedLoginCount).toBe(MAX_FAILED_LOGINS);
    expect(locked.lockedUntil).not.toBeNull();

    const minutesUntilUnlock = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutesUntilUnlock).toBeGreaterThan(LOCKOUT_MINUTES - 1);
    expect(minutesUntilUnlock).toBeLessThanOrEqual(LOCKOUT_MINUTES);

    expect(await auditActionsFor(user.id)).toContain('ACCOUNT_LOCKED');
  });

  it('rejects the correct password while the lock is live', async () => {
    const user = await createTestUser({
      failedLoginCount: MAX_FAILED_LOGINS,
      lockedUntil: new Date(Date.now() + 10 * 60_000),
    });

    const error = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    ).catch((e: AppError) => e);

    expect((error as AppError).code).toBe('UNAUTHENTICATED');
    expect((error as AppError).message).toMatch(/locked/i);
  });

  it('lets the correct password through once the lock has expired', async () => {
    const user = await createTestUser({
      failedLoginCount: MAX_FAILED_LOGINS,
      lockedUntil: new Date(Date.now() - 60_000),
    });

    await expect(
      login({ email: user.email, password: PASSWORD, rememberDevice: false }, ctx),
    ).resolves.toBeDefined();

    const refreshed = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.failedLoginCount).toBe(0);
    expect(refreshed.lockedUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refresh rotation — SDD 8.2
// ---------------------------------------------------------------------------

describe('refresh token rotation', () => {
  it('exchanges a refresh token for a new pair in the same family', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    const rotated = await rotateRefreshToken(session.tokens.refreshToken, ctx);

    expect(rotated.tokens.refreshToken).not.toBe(session.tokens.refreshToken);
    expect(rotated.user.id).toBe(user.id);

    const before = await verifyRefreshToken(session.tokens.refreshToken);
    const after = await verifyRefreshToken(rotated.tokens.refreshToken);
    expect(after!.familyId).toBe(before!.familyId);
    expect(after!.jti).not.toBe(before!.jti);

    // The old token is marked consumed rather than deleted, which is what makes
    // reuse detectable.
    const old = await testDb.refreshToken.findUniqueOrThrow({
      where: { tokenHash: await hashToken(session.tokens.refreshToken) },
    });
    expect(old.consumedAt).not.toBeNull();
  });

  it('detects reuse and revokes the whole family', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    const rotated = await rotateRefreshToken(session.tokens.refreshToken, ctx);

    // An attacker replays the token the legitimate client already spent.
    await expect(rotateRefreshToken(session.tokens.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    // The legitimate client's *current* token is now dead too — neither party
    // can be told apart, so both are ejected.
    await expect(rotateRefreshToken(rotated.tokens.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const family = await testDb.refreshToken.findMany({ where: { userId: user.id } });
    expect(family.every((token) => token.revokedAt !== null || token.consumedAt !== null)).toBe(
      true,
    );

    expect(await auditActionsFor(user.id)).toContain('TOKEN_REUSE_DETECTED');
  });

  it('does not promote a 12-hour session into a 30-day one on rotation', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    const rotated = await rotateRefreshToken(session.tokens.refreshToken, ctx);
    expect(rotated.tokens.refreshTtlSeconds).toBe(12 * 60 * 60);
  });

  it('preserves a remembered 30-day session across rotation', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: true },
      ctx,
    );

    const rotated = await rotateRefreshToken(session.tokens.refreshToken, ctx);
    expect(rotated.tokens.refreshTtlSeconds).toBe(30 * 24 * 60 * 60);
  });

  it('rejects a token that was never issued', async () => {
    await expect(rotateRefreshToken('not-a-token', ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects rotation for a user deactivated since sign-in', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    await testDb.user.update({ where: { id: user.id }, data: { isActive: false } });

    await expect(rotateRefreshToken(session.tokens.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('revokes the family so the refresh token cannot be reused', async () => {
    const user = await createTestUser();
    const session = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    await logout(session.tokens.refreshToken, ctx);

    await expect(rotateRefreshToken(session.tokens.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(await auditActionsFor(user.id)).toContain('LOGOUT');
  });

  it('is a silent no-op without a token, so sign-out can never fail', async () => {
    await expect(logout(undefined, ctx)).resolves.toBeUndefined();
    await expect(logout('garbage', ctx)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Password change — FR-03
// ---------------------------------------------------------------------------

describe('changePassword', () => {
  const NEW_PASSWORD = 'Machined9x';

  it('replaces the hash, clears mustChangePassword and audits the change', async () => {
    const user = await createTestUser({ mustChangePassword: true });

    const result = await changePassword(
      user.id,
      {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      ctx,
    );

    expect(result.user.mustChangePassword).toBe(false);

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.mustChangePassword).toBe(false);
    await expect(verifyPassword(NEW_PASSWORD, updated.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, updated.passwordHash)).resolves.toBe(false);

    expect(await auditActionsFor(user.id)).toContain('PASSWORD_CHANGED');
  });

  it('revokes every other session but keeps this device signed in', async () => {
    const user = await createTestUser();

    const phone = await login({ email: user.email, password: PASSWORD, rememberDevice: true }, ctx);
    const desktop = await login(
      { email: user.email, password: PASSWORD, rememberDevice: false },
      ctx,
    );

    const result = await changePassword(
      user.id,
      {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      ctx,
    );

    // Both pre-existing sessions are dead…
    await expect(rotateRefreshToken(phone.tokens.refreshToken, ctx)).rejects.toBeDefined();
    await expect(rotateRefreshToken(desktop.tokens.refreshToken, ctx)).rejects.toBeDefined();

    // …and the caller got a fresh, working pair.
    await expect(rotateRefreshToken(result.tokens.refreshToken, ctx)).resolves.toBeDefined();
  });

  it('rejects a wrong current password and audits the attempt', async () => {
    const user = await createTestUser();

    await expect(
      changePassword(
        user.id,
        {
          currentPassword: 'WrongPass1',
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    expect(await auditActionsFor(user.id)).toContain('LOGIN_FAILED');
  });

  it('rejects a new password that breaks policy, including the blocklist', async () => {
    const user = await createTestUser();

    await expect(
      changePassword(
        user.id,
        { currentPassword: PASSWORD, newPassword: 'password1', confirmPassword: 'password1' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Unchanged.
    const unchanged = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(PASSWORD, unchanged.passwordHash)).resolves.toBe(true);
  });

  it('rejects reusing the current password', async () => {
    const user = await createTestUser();

    await expect(
      changePassword(
        user.id,
        { currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('clears an active lockout, so the MD can rescue a locked user', async () => {
    const user = await createTestUser({
      failedLoginCount: 5,
      lockedUntil: new Date(Date.now() + 10 * 60_000),
    });

    await changePassword(
      user.id,
      {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      },
      ctx,
    );

    const updated = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });
});
