/**
 * Account lifecycle: deactivation with hand-over, reactivation, password reset.
 *
 * Nothing here deletes a row (architecture rule 6, FR-70). A departed
 * employee's name has to keep resolving on every job they ever touched, so the
 * account is switched off and its work is handed on in the same transaction.
 */
import { prisma } from '@/lib/db/prisma';
import { AppError, conflict, notFound } from '@/lib/errors';
import { hashPassword } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/auth/temp-password';
import { writeAudit } from '@/lib/services/audit-service';
import type { DeactivateUserInput } from '@/lib/validation/user';

import { assertNotLastActiveMd, resolveReassignmentTarget } from './invariants';
import { findOpenSubtasks } from './queries';
import {
  USER_SELECT,
  redactUser,
  toSummary,
  type Actor,
  type OpenSubtaskRef,
  type RequestContext,
  type UserSummary,
} from './types';

export interface DeactivationResult {
  user: UserSummary;
  /** Subtasks moved to the replacement, empty when there were none. */
  reassigned: OpenSubtaskRef[];
  reassignedTo: { id: string; name: string } | null;
}

/**
 * Deactivates a user (FR-70 — never a hard delete).
 *
 * Refuses with `CONFLICT` when the user still holds open subtasks and no
 * replacement was named, and the error lists them so the MD can see exactly
 * what is in the way. Supplying `reassignTo` moves them in the same transaction
 * as the deactivation, so there is no window in which the work is owned by a
 * disabled account (PDD section 12: "One person leaves and his subtasks are
 * orphaned").
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`
 */
export async function deactivateUser(
  userId: string,
  input: DeactivateUserInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<DeactivationResult> {
  const leaving = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!leaving) throw notFound('User');

  if (userId === actor.id) {
    throw conflict('You cannot deactivate your own account.', { reason: 'SELF_DEACTIVATION' });
  }

  if (!leaving.isActive) {
    throw conflict(`${leaving.name} is already deactivated.`, { reason: 'ALREADY_INACTIVE' });
  }

  await assertNotLastActiveMd(prisma, userId, 'deactivate');

  const openSubtasks = await findOpenSubtasks(prisma, userId);

  if (openSubtasks.length > 0 && !input.reassignTo) {
    throw new AppError(
      'CONFLICT',
      `${leaving.name} still has ${openSubtasks.length} open ${
        openSubtasks.length === 1 ? 'subtask' : 'subtasks'
      }. Choose somebody to take them over.`,
      {
        details: {
          reason: 'OPEN_SUBTASKS',
          openSubtaskCount: openSubtasks.length,
          openSubtasks: openSubtasks.map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            status: subtask.status,
            deadline: subtask.deadline.toISOString(),
            jobId: subtask.jobId,
            jobCode: subtask.jobCode,
            departmentName: subtask.departmentName,
          })),
        },
      },
    );
  }

  const target = input.reassignTo
    ? await resolveReassignmentTarget(prisma, leaving, input.reassignTo)
    : null;

  const result = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: a subtask could have been assigned
    // between the check above and here, and it must not be left behind.
    const stillOpen = await findOpenSubtasks(tx, userId);

    if (stillOpen.length > 0 && !target) {
      throw conflict(`${leaving.name} has open subtasks that must be reassigned first.`, {
        reason: 'OPEN_SUBTASKS',
        openSubtaskCount: stillOpen.length,
      });
    }

    if (target && stillOpen.length > 0) {
      await tx.subtask.updateMany({
        where: { id: { in: stillOpen.map((subtask) => subtask.id) } },
        data: { assigneeId: target.id },
      });

      // One row per subtask, on the subtask, so its own history is complete —
      // a year later the question is "who used to own this?", not "what did we
      // do to that user account?".
      for (const subtask of stillOpen) {
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'USER_REASSIGNED',
          entityType: 'SUBTASK',
          entityId: subtask.id,
          before: { assigneeId: userId, assigneeName: leaving.name },
          after: { assigneeId: target.id, assigneeName: target.name },
          ipAddress: ctx.ipAddress,
        });
      }
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        // Kill every live session immediately; a deactivated account must not
        // survive on a phone that is already signed in.
        refreshTokens: {
          updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } },
        },
      },
      select: USER_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'USER_DEACTIVATED',
      entityType: 'USER',
      entityId: userId,
      before: redactUser(leaving),
      after: {
        ...(redactUser(updated) as Record<string, unknown>),
        reassignedTo: target?.id ?? null,
        reassignedSubtaskCount: stillOpen.length,
        reason: input.reason ?? null,
      },
      ipAddress: ctx.ipAddress,
    });

    return { user: updated, reassigned: stillOpen };
  });

  return {
    user: toSummary(result.user),
    reassigned: result.reassigned,
    reassignedTo: target,
  };
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

export interface PasswordResetResult {
  user: UserSummary;
  temporaryPassword: string;
}

/**
 * Issues a new temporary password (FR-03).
 *
 * Clears any lockout, forces a change at next sign-in, and revokes every
 * existing session — an administrator resets a password precisely when they
 * suspect the old one is compromised, so leaving live sessions running would
 * defeat the point.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`
 */
export async function resetPassword(
  userId: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<PasswordResetResult> {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!before) throw notFound('User');

  if (!before.isActive) {
    throw conflict(
      `${before.name} is deactivated. Reactivate the account before resetting its password.`,
      { reason: 'INACTIVE_USER' },
    );
  }

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: USER_SELECT,
    });

    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'PASSWORD_RESET',
      entityType: 'USER',
      entityId: userId,
      // No password material on either side — only the flags that changed.
      before: { mustChangePassword: before.mustChangePassword, lockedUntil: before.lockedUntil },
      after: { mustChangePassword: true, lockedUntil: null, sessionsRevoked: true },
      ipAddress: ctx.ipAddress,
    });

    return user;
  });

  return { user: toSummary(updated), temporaryPassword };
}

/**
 * Reactivates a previously deactivated user.
 *
 * The counterpart to `deactivateUser` — without it, "never hard-delete" would
 * mean a mistaken deactivation is unrecoverable through the UI.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`
 */
export async function reactivateUser(
  userId: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<UserSummary> {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!before) throw notFound('User');

  if (before.isActive) {
    throw conflict(`${before.name} is already active.`, { reason: 'ALREADY_ACTIVE' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { isActive: true, failedLoginCount: 0, lockedUntil: null },
      select: USER_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: userId,
      before: redactUser(before),
      after: redactUser(user),
      ipAddress: ctx.ipAddress,
    });

    return user;
  });

  return toSummary(updated);
}
