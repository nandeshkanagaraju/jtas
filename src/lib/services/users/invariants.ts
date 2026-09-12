/**
 * Guards that every user mutation shares.
 *
 * Kept apart from the mutations themselves because each of these encodes a rule
 * that outlives the operation that happens to call it today — and because they
 * are the part most worth reading on their own.
 */
import type { Role } from '@prisma/client';

import { type Db } from '@/lib/db/prisma';
import { conflict, validationError } from '@/lib/errors';
import { DEPARTMENT_ROLES } from '@/lib/validation/user';

import type { UserRow } from './types';

/**
 * Re-checks the role/department invariant server-side.
 *
 * The shared Zod schema already enforces it, but a route handler is not the
 * only caller a service will ever have, and a validation rule that exists only
 * at the boundary is one refactor away from being skipped.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export function assertRoleDepartment(role: Role, departmentId: string | null): void {
  const needsDepartment = (DEPARTMENT_ROLES as readonly string[]).includes(role);

  if (needsDepartment && !departmentId) {
    throw validationError('A member must belong to a department.', {
      fields: { departmentId: ['A member must belong to a department.'] },
    });
  }

  if (!needsDepartment && departmentId) {
    throw validationError('Only members belong to a department.', {
      fields: { departmentId: ['Only members belong to a department.'] },
    });
  }
}

/** @throws {AppError} `VALIDATION_ERROR` when the department does not exist. */
export async function assertDepartmentExists(db: Db, departmentId: string | null): Promise<void> {
  if (!departmentId) return;

  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, isActive: true },
  });

  if (!department) {
    throw validationError('That department does not exist.', {
      fields: { departmentId: ['That department does not exist.'] },
    });
  }
}

/**
 * Refuses to leave the system without an active MD.
 *
 * Not in the build spec, but the MD is the only role that can create or publish
 * a job (SDD section 6.3). Demoting or deactivating the last one would leave a
 * running factory unable to issue work, with no way back in through the UI.
 *
 * @throws {AppError} `CONFLICT`
 */
export async function assertNotLastActiveMd(db: Db, userId: string, action: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });

  if (!user || user.role !== 'MD' || !user.isActive) return;

  const otherActiveMds = await db.user.count({
    where: { role: 'MD', isActive: true, id: { not: userId } },
  });

  if (otherActiveMds === 0) {
    throw conflict(
      `This is the only active Managing Director. Appoint another one before you ${action} this account.`,
      { reason: 'LAST_ACTIVE_MD' },
    );
  }
}

/**
 * Maps Prisma's unique-constraint violation on `email` to a CONFLICT.
 *
 * The race is real: two administrators can submit the same address between the
 * lookup and the insert, so the database constraint is the actual guarantee and
 * this is how its failure reaches the user.
 */
export function rethrowEmailConflict(error: unknown, email: string): never {
  const code = (error as { code?: string }).code;

  if (code === 'P2002') {
    throw conflict(`${email} is already registered to another user.`, {
      fields: { email: ['This email address is already in use.'] },
    });
  }

  throw error;
}

/**
 * Validates a proposed replacement assignee.
 *
 * Three rules, and each one exists because breaking it strands work:
 *
 *  - **Active.** Handing subtasks to another deactivated account just moves the
 *    problem.
 *  - **Same department.** A Quality member cannot sign off Production's work.
 *    For an MD or Deputy — who have no department — this resolves to another
 *    user with no department, which is the right answer: their work goes to a
 *    peer, not to a shop-floor member.
 *  - **Not an ADMIN.** An administrator is a caretaker of accounts, not a
 *    participant; `can()` refuses them `subtask:updateStatus`, so a subtask
 *    assigned to one could never be completed by anybody.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export async function resolveReassignmentTarget(
  db: Db,
  leaving: UserRow,
  reassignTo: string,
): Promise<{ id: string; name: string }> {
  if (reassignTo === leaving.id) {
    throw validationError('Choose somebody other than the user being deactivated.', {
      fields: { reassignTo: ['Choose a different user.'] },
    });
  }

  const target = await db.user.findUnique({
    where: { id: reassignTo },
    select: { id: true, name: true, role: true, departmentId: true, isActive: true },
  });

  if (!target) {
    throw validationError('That user does not exist.', {
      fields: { reassignTo: ['That user does not exist.'] },
    });
  }

  if (!target.isActive) {
    throw validationError(`${target.name} is deactivated and cannot take on work.`, {
      fields: { reassignTo: ['Choose an active user.'] },
    });
  }

  if (target.role === 'ADMIN') {
    throw validationError(`${target.name} is an administrator and cannot be assigned subtasks.`, {
      fields: { reassignTo: ['Choose a member, the MD, or the deputy.'] },
    });
  }

  if (target.departmentId !== leaving.departmentId) {
    throw validationError(`${target.name} is not in the same department.`, {
      fields: { reassignTo: ['Choose somebody from the same department.'] },
    });
  }

  return { id: target.id, name: target.name };
}
