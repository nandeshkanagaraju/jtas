/**
 * Integration-test database helpers.
 *
 * These tests run against a real PostgreSQL instance because the behaviour
 * under test — transactional audit writes, the unique index that makes
 * refresh-token reuse detectable, lockout counters — is database behaviour. A
 * mocked Prisma client would assert that the code calls itself correctly and
 * prove nothing about whether it works.
 */
import { PrismaClient, type Role } from '@prisma/client';

import { hashPassword } from '@/lib/auth/password';

export const testDb = new PrismaClient();

/** Truncates everything the auth and directory tests touch, children first. */
export async function resetAuthTables(): Promise<void> {
  await testDb.auditLog.deleteMany();
  await testDb.refreshToken.deleteMany();
  await testDb.subtask.deleteMany();
  await testDb.job.deleteMany();
  await testDb.user.deleteMany();
  await testDb.department.deleteMany();
}

/** Creates a department, defaulting to a unique code so specs cannot collide. */
export async function createTestDepartment(
  overrides: { code?: string; name?: string; sequenceOrder?: number } = {},
) {
  const code = overrides.code ?? `DEPT_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  return testDb.department.create({
    data: {
      code,
      name: overrides.name ?? code,
      sequenceOrder: overrides.sequenceOrder ?? 1,
    },
  });
}

/**
 * Creates a job and one subtask on it.
 *
 * M2 needs real subtasks to exercise the deactivation block, and the Job and
 * Subtask models already exist from M0 — so the fixture is built directly
 * rather than waiting for the M3/M4 services.
 */
export async function createTestSubtask(options: {
  assigneeId: string;
  departmentId: string;
  createdById?: string;
  status?: import('@prisma/client').SubtaskStatus;
  title?: string;
  deadline?: Date;
  jobCode?: string;
}) {
  const suffix = crypto.randomUUID().slice(0, 8);

  const job = await testDb.job.create({
    data: {
      jobCode: options.jobCode ?? `JGE-2026-${suffix}`,
      title: `Test job ${suffix}`,
      overallDeadline: new Date('2026-12-31T12:00:00Z'),
      createdById: options.createdById ?? options.assigneeId,
      status: 'IN_PROGRESS',
    },
  });

  return testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: options.departmentId,
      assigneeId: options.assigneeId,
      title: options.title ?? `Subtask ${suffix}`,
      deadline: options.deadline ?? new Date('2026-12-01T12:00:00Z'),
      status: options.status ?? 'IN_PROGRESS',
    },
  });
}

export interface TestUserOptions {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
  mustChangePassword?: boolean;
  departmentId?: string | null;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
}

/** Creates a user with a real bcrypt hash, so login exercises the real path. */
export async function createTestUser(options: TestUserOptions = {}) {
  const password = options.password ?? 'Shopfloor7';

  return testDb.user.create({
    data: {
      name: options.name ?? 'Test User',
      email: options.email ?? `user-${crypto.randomUUID()}@jaraaglobal.com`,
      passwordHash: await hashPassword(password),
      role: options.role ?? 'MEMBER',
      isActive: options.isActive ?? true,
      mustChangePassword: options.mustChangePassword ?? false,
      failedLoginCount: options.failedLoginCount ?? 0,
      lockedUntil: options.lockedUntil ?? null,
      departmentId: options.departmentId ?? null,
    },
  });
}

/** Every audit row for an entity, oldest first. */
export async function auditRowsFor(entityId: string) {
  return testDb.auditLog.findMany({
    where: { entityId },
    orderBy: { createdAt: 'asc' },
  });
}

/** The audit actions recorded for an entity, in order. */
export async function auditActionsFor(entityId: string): Promise<string[]> {
  return (await auditRowsFor(entityId)).map((row) => row.action);
}
