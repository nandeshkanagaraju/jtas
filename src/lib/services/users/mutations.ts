/**
 * Creating and editing a user.
 *
 * Both write their audit row inside the same transaction as the change
 * (architecture rule 5), and both re-apply the role/department invariant
 * server-side even though the shared Zod schema already checked it — a
 * validation rule that exists only at the boundary is one refactor away from
 * being skipped.
 */
import { hashPassword } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/auth/temp-password';
import { prisma } from '@/lib/db/prisma';
import { notFound } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import type { CreateUserInput, UpdateUserInput } from '@/lib/validation/user';

import {
  assertDepartmentExists,
  assertNotLastActiveMd,
  assertRoleDepartment,
  rethrowEmailConflict,
} from './invariants';
import {
  USER_SELECT,
  redactUser,
  toSummary,
  type Actor,
  type RequestContext,
  type UserSummary,
} from './types';

/**
 * The temporary password is returned exactly once, in the create response.
 *
 * It exists in memory, in that response, and as a bcrypt hash. It is never
 * written to a log, never stored in plain text, and cannot be read back — a
 * lost one is reset, not recovered.
 */
export interface CreatedUser {
  user: UserSummary;
  temporaryPassword: string;
}

export async function createUser(
  input: CreateUserInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<CreatedUser> {
  const departmentId = input.departmentId ?? null;

  assertRoleDepartment(input.role, departmentId);
  await assertDepartmentExists(prisma, departmentId);

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          // Lower-cased by the shared schema, so a login cannot fail on
          // capitalisation and the unique index means what it looks like.
          email: input.email,
          phone: input.phone ?? null,
          role: input.role,
          departmentId,
          passwordHash,
          // FR-03: the temporary password is good for exactly one sign-in.
          mustChangePassword: true,
        },
        select: USER_SELECT,
      });

      await writeAudit(tx, {
        actorId: actor.id,
        action: 'USER_CREATED',
        entityType: 'USER',
        entityId: user.id,
        after: redactUser(user),
        ipAddress: ctx.ipAddress,
      });

      return user;
    });

    return { user: toSummary(created), temporaryPassword };
  } catch (error) {
    rethrowEmailConflict(error, input.email);
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<UserSummary> {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!before) throw notFound('User');

  const role = input.role ?? before.role;
  // `departmentId` is tri-state: absent means "leave it", null means "clear it".
  const departmentId = input.departmentId === undefined ? before.departmentId : input.departmentId;

  assertRoleDepartment(role, departmentId);
  await assertDepartmentExists(prisma, departmentId);

  if (input.role && input.role !== before.role) {
    await assertNotLastActiveMd(prisma, userId, 'change the role of');
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.departmentId !== undefined ? { departmentId } : {}),
        },
        select: USER_SELECT,
      });

      await writeAudit(tx, {
        actorId: actor.id,
        action: 'USER_UPDATED',
        entityType: 'USER',
        entityId: user.id,
        before: redactUser(before),
        after: redactUser(user),
        ipAddress: ctx.ipAddress,
      });

      return user;
    });

    return toSummary(updated);
  } catch (error) {
    rethrowEmailConflict(error, input.email ?? before.email);
  }
}
