/**
 * Prisma client singleton.
 *
 * Next.js hot-reload re-evaluates modules on every edit. Without the global
 * cache below, each reload would open a fresh connection pool and the dev
 * database would run out of connections within a few minutes.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * The transaction-scoped client type. Services take this so they can be
 * composed inside a single `prisma.$transaction`, which is what lets every
 * mutation write its AuditLog row atomically with the change itself.
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either the root client or a transaction handle. */
export type Db = PrismaClient | PrismaTransactionClient;
