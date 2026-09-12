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

/** Truncates everything the auth tests touch, children first. */
export async function resetAuthTables(): Promise<void> {
  await testDb.auditLog.deleteMany();
  await testDb.refreshToken.deleteMany();
  await testDb.user.deleteMany();
}

export interface TestUserOptions {
  email?: string;
  name?: string;
  password?: string;
  role?: Role;
  isActive?: boolean;
  mustChangePassword?: boolean;
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
