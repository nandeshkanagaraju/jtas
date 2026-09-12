/**
 * Authentication business rules (architecture rule 2 — none of this belongs in
 * a route handler or a component).
 *
 * Covers login with lockout, refresh-token rotation with family invalidation,
 * logout, and password change. Every state change writes its audit row inside
 * the same transaction (rule 5).
 */
import type { Role, User } from '@prisma/client';

import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  REFRESH_TTL_SECONDS_REMEMBERED,
  hashToken,
  newTokenId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@/lib/auth/jwt';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '@/lib/auth/password';
import { prisma, type Db } from '@/lib/db/prisma';
import { AppError, unauthenticated, validationError } from '@/lib/errors';
import { tryWriteAudit, writeAudit } from '@/lib/services/audit-service';
import { addMinutes } from '@/lib/utils/time';
import { moduleLogger } from '@/lib/utils/logger';
import type { ChangePasswordInput, LoginInput } from '@/lib/validation/auth';

const log = moduleLogger('auth-service');

/** FR-06: five failures locks the account… */
export const MAX_FAILED_LOGINS = 5;

/** …for fifteen minutes. */
export const LOCKOUT_MINUTES = 15;

/**
 * One message for every failure mode of login.
 *
 * A distinct "no such user" would let anyone enumerate the staff list, and a
 * distinct "wrong password" would confirm an address is real. Locked accounts
 * get their own message only because the user cannot act on the generic one.
 */
const GENERIC_LOGIN_FAILURE = 'Email or password is incorrect.';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshTtlSeconds: number;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  mustChangePassword: boolean;
}

export interface LoginResult {
  user: AuthenticatedUser;
  tokens: SessionTokens;
}

export interface RequestContext {
  ipAddress: string;
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    mustChangePassword: user.mustChangePassword,
  };
}

// ---------------------------------------------------------------------------
// Token issuance
// ---------------------------------------------------------------------------

/**
 * Mints an access/refresh pair and persists the refresh hash.
 *
 * @param familyId Continues an existing rotation family, or starts a new one.
 */
async function issueTokens(
  db: Db,
  user: User,
  options: { rememberDevice: boolean; familyId?: string },
): Promise<SessionTokens> {
  const refreshTtlSeconds = options.rememberDevice
    ? REFRESH_TTL_SECONDS_REMEMBERED
    : REFRESH_TTL_SECONDS;

  const familyId = options.familyId ?? newTokenId();
  const jti = newTokenId();

  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    departmentId: user.departmentId,
    mustChangePassword: user.mustChangePassword,
  });

  const refreshToken = await signRefreshToken({ sub: user.id, familyId, jti }, refreshTtlSeconds);

  // Only the hash is stored, so a leaked backup yields nothing usable.
  await db.refreshToken.create({
    data: {
      userId: user.id,
      familyId,
      tokenHash: await hashToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
    },
  });

  return { accessToken, refreshToken, refreshTtlSeconds };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Authenticates a user (FR-01, FR-06).
 *
 * Failure counting, lockout and the audit trail all happen here; the route
 * handler only maps the thrown error to HTTP.
 *
 * @throws {AppError} `UNAUTHENTICATED` on bad credentials, an inactive account,
 *         or a locked account.
 */
export async function login(input: LoginInput, ctx: RequestContext): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Unknown address: no row to count against, so record the attempt and stop.
  // The bcrypt comparison is skipped, which is a small timing signal; it is
  // accepted here because the alternative — hashing on every unknown email —
  // turns the login route into a CPU denial-of-service target, and the IP rate
  // limit already caps enumeration at 10 attempts a minute.
  if (!user) {
    await tryWriteAudit(prisma, {
      actorId: null,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: input.email,
      after: { reason: 'UNKNOWN_EMAIL', email: input.email },
      ipAddress: ctx.ipAddress,
    });
    throw unauthenticated(GENERIC_LOGIN_FAILURE);
  }

  // A live lock short-circuits before the password is even checked, so a
  // locked account cannot be probed.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    await tryWriteAudit(prisma, {
      actorId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      after: { reason: 'ACCOUNT_LOCKED', lockedUntil: user.lockedUntil.toISOString() },
      ipAddress: ctx.ipAddress,
    });
    throw unauthenticated(
      `This account is locked after too many failed attempts. Try again in ${minutesLeft} minute${
        minutesLeft === 1 ? '' : 's'
      }.`,
    );
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    await recordFailedAttempt(user, ctx);
    throw unauthenticated(GENERIC_LOGIN_FAILURE);
  }

  // Deactivated accounts keep their history (FR-70) but cannot sign in. Checked
  // after the password so that a wrong password on a deactivated account still
  // returns the generic message.
  if (!user.isActive) {
    await tryWriteAudit(prisma, {
      actorId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      after: { reason: 'INACTIVE_ACCOUNT' },
      ipAddress: ctx.ipAddress,
    });
    throw unauthenticated('This account has been deactivated. Contact the administrator.');
  }

  return prisma.$transaction(async (tx) => {
    const refreshed = await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const tokens = await issueTokens(tx, refreshed, {
      rememberDevice: input.rememberDevice,
    });

    await writeAudit(tx, {
      actorId: refreshed.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'SESSION',
      entityId: refreshed.id,
      after: {
        rememberDevice: input.rememberDevice,
        mustChangePassword: refreshed.mustChangePassword,
      },
      ipAddress: ctx.ipAddress,
    });

    return { user: toAuthenticatedUser(refreshed), tokens };
  });
}

/**
 * Increments the failure counter and locks the account on the fifth failure
 * (FR-06), writing `LOGIN_FAILED` and, at the threshold, `ACCOUNT_LOCKED`.
 */
async function recordFailedAttempt(user: User, ctx: RequestContext): Promise<void> {
  const nextCount = user.failedLoginCount + 1;
  const shouldLock = nextCount >= MAX_FAILED_LOGINS;
  const lockedUntil = shouldLock ? addMinutes(new Date(), LOCKOUT_MINUTES) : null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: nextCount,
        // Only set on the transition; an existing lock is never shortened.
        ...(shouldLock ? { lockedUntil } : {}),
      },
    });

    await writeAudit(tx, {
      actorId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      after: { reason: 'BAD_PASSWORD', failedLoginCount: nextCount },
      ipAddress: ctx.ipAddress,
    });

    if (shouldLock && lockedUntil) {
      await writeAudit(tx, {
        actorId: user.id,
        action: 'ACCOUNT_LOCKED',
        entityType: 'USER',
        entityId: user.id,
        after: { lockedUntil: lockedUntil.toISOString(), failedLoginCount: nextCount },
        ipAddress: ctx.ipAddress,
      });
    }
  });

  if (shouldLock) {
    log.warn({ userId: user.id, ip: ctx.ipAddress }, 'account locked after repeated failures');
  }
}

// ---------------------------------------------------------------------------
// Refresh rotation
// ---------------------------------------------------------------------------

/**
 * Rotates a refresh token (SDD section 8.2).
 *
 * Single use. Presenting a token that has already been consumed means either a
 * stolen token or a replay, and in neither case can the legitimate holder be
 * told apart from the attacker — so the entire family is revoked and everyone
 * holding it is forced to sign in again.
 *
 * @throws {AppError} `UNAUTHENTICATED` on an invalid, expired, revoked or
 *         reused token.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  ctx: RequestContext,
): Promise<LoginResult> {
  const claims = await verifyRefreshToken(presentedToken);
  if (!claims) throw unauthenticated('Your session has expired. Please sign in again.');

  const tokenHash = await hashToken(presentedToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) throw unauthenticated('Your session has expired. Please sign in again.');

  // Reuse detection: the token was already exchanged once.
  if (stored.consumedAt) {
    await revokeFamily(stored.familyId, stored.userId, ctx, 'TOKEN_REUSE_DETECTED');
    log.warn(
      { userId: stored.userId, familyId: stored.familyId, ip: ctx.ipAddress },
      'refresh token reuse detected; family revoked',
    );
    throw unauthenticated('Your session was ended for security reasons. Please sign in again.');
  }

  if (stored.revokedAt || stored.expiresAt <= new Date()) {
    throw unauthenticated('Your session has expired. Please sign in again.');
  }

  if (!stored.user.isActive) {
    throw unauthenticated('This account has been deactivated. Contact the administrator.');
  }

  // Preserve the original lifetime: rotating must not silently promote a
  // 12-hour session into a 30-day one.
  const remembered =
    stored.expiresAt.getTime() - stored.createdAt.getTime() > REFRESH_TTL_SECONDS * 1000;

  return prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { consumedAt: new Date() },
    });

    const tokens = await issueTokens(tx, stored.user, {
      rememberDevice: remembered,
      familyId: stored.familyId,
    });

    await writeAudit(tx, {
      actorId: stored.userId,
      action: 'TOKEN_REFRESHED',
      entityType: 'SESSION',
      entityId: stored.userId,
      after: { familyId: stored.familyId },
      ipAddress: ctx.ipAddress,
    });

    return { user: toAuthenticatedUser(stored.user), tokens };
  });
}

/** Revokes every unconsumed token in a family and records why. */
async function revokeFamily(
  familyId: string,
  userId: string,
  ctx: RequestContext,
  action: 'TOKEN_REUSE_DETECTED' | 'LOGOUT',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAudit(tx, {
      actorId: userId,
      action,
      entityType: 'SESSION',
      entityId: userId,
      after: { familyId, revokedCount: count },
      ipAddress: ctx.ipAddress,
    });
  });
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * Ends a session.
 *
 * Revokes the whole family rather than the single token, so signing out on a
 * shared shop-floor terminal cannot leave a usable refresh token behind.
 * Always succeeds — a logout that can fail is worse than one that is a no-op.
 */
export async function logout(
  presentedToken: string | undefined,
  ctx: RequestContext,
): Promise<void> {
  if (!presentedToken) return;

  const claims = await verifyRefreshToken(presentedToken);
  if (!claims) return;

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: await hashToken(presentedToken) },
  });
  if (!stored) return;

  await revokeFamily(stored.familyId, stored.userId, ctx, 'LOGOUT');
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

/**
 * Changes a password (FR-03).
 *
 * Clears `mustChangePassword`, revokes every other session, and issues a fresh
 * pair so the caller stays signed in on this device. Revoking the rest is the
 * point of forcing a change after an admin reset: any session opened with the
 * temporary password dies here.
 *
 * @throws {AppError} `UNAUTHENTICATED` if the current password is wrong,
 *         `VALIDATION_ERROR` if the new one breaks policy.
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  ctx: RequestContext,
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthenticated();

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await tryWriteAudit(prisma, {
      actorId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'SESSION',
      entityId: user.id,
      after: { reason: 'BAD_CURRENT_PASSWORD_ON_CHANGE' },
      ipAddress: ctx.ipAddress,
    });
    throw new AppError('UNAUTHENTICATED', 'Your current password is incorrect.', {
      details: { fields: { currentPassword: ['Your current password is incorrect.'] } },
    });
  }

  // Re-checked server-side even though the shared Zod schema ran on the client:
  // the blocklist is server-only, and a client check is never a control.
  assertPasswordPolicy(input.newPassword);

  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw validationError('The new password must be different from the current one.', {
      fields: { newPassword: ['The new password must be different from the current one.'] },
    });
  }

  const passwordHash = await hashPassword(input.newPassword);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    // Every session opened before this moment is now untrusted.
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const tokens = await issueTokens(tx, updated, { rememberDevice: false });

    await writeAudit(tx, {
      actorId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: user.id,
      before: { mustChangePassword: user.mustChangePassword },
      after: { mustChangePassword: false },
      ipAddress: ctx.ipAddress,
    });

    return { user: toAuthenticatedUser(updated), tokens };
  });
}

/** Re-exported so route handlers can set the access cookie's lifetime. */
export { ACCESS_TTL_SECONDS };
