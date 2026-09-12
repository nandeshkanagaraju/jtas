/**
 * Sign-in, sign-out, and the failure counting that guards them.
 */
import type { User } from '@prisma/client';

import { verifyRefreshToken, hashToken } from '@/lib/auth/jwt';
import { verifyPassword } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { unauthenticated } from '@/lib/errors';
import { tryWriteAudit, writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';
import { addMinutes } from '@/lib/utils/time';
import type { LoginInput } from '@/lib/validation/auth';

import {
  issueTokens,
  revokeFamily,
  toAuthenticatedUser,
  type LoginResult,
  type RequestContext,
} from './tokens';

const log = moduleLogger('auth-login');

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
