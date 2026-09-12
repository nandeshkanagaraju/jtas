/**
 * Session tokens: issuing a pair, rotating one, and revoking a family.
 *
 * Split out of the login flow because rotation has its own security property to
 * protect — single use, with reuse revoking everything — and that argument is
 * easier to check when it is not interleaved with password handling.
 */
import type { Role, User } from '@prisma/client';

import {
  REFRESH_TTL_SECONDS,
  REFRESH_TTL_SECONDS_REMEMBERED,
  hashToken,
  newTokenId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@/lib/auth/jwt';
import { prisma, type Db } from '@/lib/db/prisma';
import { unauthenticated } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('auth-tokens');

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

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Mints an access/refresh pair and persists the refresh hash.
 *
 * @param familyId Continues an existing rotation family, or starts a new one.
 */
export async function issueTokens(
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
export async function revokeFamily(
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
