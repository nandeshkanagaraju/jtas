/**
 * Changing one's own password (FR-03).
 */
import { verifyPassword, hashPassword, assertPasswordPolicy } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { AppError, unauthenticated, validationError } from '@/lib/errors';
import { tryWriteAudit, writeAudit } from '@/lib/services/audit-service';
import type { ChangePasswordInput } from '@/lib/validation/auth';

import { issueTokens, toAuthenticatedUser, type LoginResult, type RequestContext } from './tokens';

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
