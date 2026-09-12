/**
 * User administration shapes (architecture rule 4 — one definition, used by the
 * react-hook-form resolver and the route handler alike).
 */
import { z } from 'zod';

import { emailSchema } from './auth';
import { paginationSchema, searchSchema } from './common';

export const roleSchema = z.enum(['MD', 'DEPUTY_MD', 'ADMIN', 'MEMBER']);
export type RoleValue = z.infer<typeof roleSchema>;

/** Roles that belong to a department. */
export const DEPARTMENT_ROLES: readonly RoleValue[] = ['MEMBER'];

/**
 * Loose on purpose: Indian mobile numbers are written with and without `+91`,
 * with spaces or hyphens, and this field only ever feeds a future WhatsApp
 * adapter (FR-59). Rejecting a valid number the MD typed is worse than storing
 * a slightly untidy one.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number.')
  .optional()
  .or(z.literal('').transform(() => undefined));

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Enter the full name.')
  .max(120, 'Use at most 120 characters.');

/**
 * The invariant from the build spec: a MEMBER belongs to exactly one department;
 * MD, DEPUTY_MD and ADMIN belong to none.
 *
 * Enforced here rather than in the service so the create dialog can show the
 * error against the right field before anything is submitted — and enforced
 * again by the service, because a client check is never a control.
 */
function enforceRoleDepartment(
  value: { role: RoleValue; departmentId?: string | null },
  ctx: z.RefinementCtx,
): void {
  const needsDepartment = DEPARTMENT_ROLES.includes(value.role);

  if (needsDepartment && !value.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['departmentId'],
      message: 'A member must belong to a department.',
    });
  }

  if (!needsDepartment && value.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['departmentId'],
      message: 'Only members belong to a department.',
    });
  }
}

export const createUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    role: roleSchema,
    // `null` and absent both mean "no department"; the form sends one or the other.
    departmentId: z.string().min(1).nullable().optional(),
  })
  .superRefine(enforceRoleDepartment);

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Every field optional, but role and department are still checked together.
 *
 * `isActive` is deliberately absent: deactivation goes through DELETE, which is
 * the only path that checks for open subtasks. Allowing it here would let an
 * edit orphan somebody's work (FR-70).
 */
export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema,
    role: roleSchema.optional(),
    departmentId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Deactivation payload. `reassignTo` moves the user's open subtasks in the same
 * transaction; without it, open subtasks block the deactivation entirely.
 */
export const deactivateUserSchema = z.object({
  reassignTo: z.string().min(1).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>;

/** `?status=` on the users list. */
export const userStatusFilterSchema = z.enum(['active', 'inactive', 'all']).default('active');

export const listUsersQuerySchema = paginationSchema.merge(searchSchema).extend({
  role: roleSchema.optional(),
  departmentId: z.string().min(1).optional(),
  status: userStatusFilterSchema,
  sort: z.enum(['name', 'email', 'role', 'lastLoginAt', 'createdAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
