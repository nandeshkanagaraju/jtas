/**
 * Shared shapes for user administration.
 *
 * The Prisma select and the mappers live here so that every read path returns
 * the same object and no route can accidentally widen it — most importantly,
 * `passwordHash` is never in `USER_SELECT`, so it cannot leak by omission.
 */
import type { Prisma, Role, SubtaskStatus, User } from '@prisma/client';

/**
 * A subtask is "open" — and therefore blocks deactivation — unless it has
 * reached a terminal state. `PROBLEM`, `BLOCKED` and `ON_HOLD` all still need
 * somebody to own them.
 */
export const TERMINAL_SUBTASK_STATUSES: SubtaskStatus[] = ['COMPLETED', 'CANCELLED'];

export interface RequestContext {
  ipAddress: string;
}

export interface Actor {
  id: string;
}

/** What the API returns for a user. Never includes `passwordHash`. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  createdAt: Date;
  /** Open subtasks currently assigned, so the table can warn before deactivation. */
  openSubtaskCount?: number;
}

/** One of the user's blocking subtasks, as reported in a CONFLICT. */
export interface OpenSubtaskRef {
  id: string;
  title: string;
  status: SubtaskStatus;
  deadline: Date | null;
  jobId: string;
  jobCode: string;
  departmentId: string;
  departmentName: string;
}

export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  departmentId: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  department: { select: { name: true } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  };
}

/**
 * The audit snapshot of a user.
 *
 * `passwordHash` is stripped explicitly rather than by picking fields, so that
 * a column added to the model later cannot quietly start appearing in the log.
 */
export function redactUser(user: User | UserRow | Record<string, unknown>): Prisma.InputJsonValue {
  const snapshot: Record<string, unknown> = { ...user };
  delete snapshot.passwordHash;
  delete snapshot.department;
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}
