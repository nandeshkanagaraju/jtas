import { expect, test } from 'vitest';

import { prisma } from '../../src/lib/db/prisma';

test('a department workflow can finish a transaction after five seconds of database latency', async () => {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_sleep(5.1)`;
    return tx.$queryRaw<Array<{ ready: number }>>`SELECT 1 AS ready`;
  });

  expect(result).toEqual([{ ready: 1 }]);
});
