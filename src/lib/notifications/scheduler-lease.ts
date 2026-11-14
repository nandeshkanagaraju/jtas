import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db/prisma';

/** A Job Function is limited to 15 minutes; its lease outlives that limit. */
export async function withSchedulerLease<T>(run: () => Promise<T>): Promise<T | null> {
  const owner = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ owner: string }>>`
    INSERT INTO "SchedulerLease" ("key", "owner", "expiresAt")
    VALUES ('notifications', ${owner}, CURRENT_TIMESTAMP + INTERVAL '16 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "owner" = EXCLUDED."owner", "expiresAt" = EXCLUDED."expiresAt"
    WHERE "SchedulerLease"."expiresAt" <= CURRENT_TIMESTAMP
    RETURNING "owner"
  `;
  if (rows.length === 0) return null;
  try {
    return await run();
  } finally {
    await prisma.schedulerLease.deleteMany({ where: { key: 'notifications', owner } });
  }
}
