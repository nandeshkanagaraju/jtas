import { prisma } from '@/lib/db/prisma';
import { queueDailyDigest, queueDepartmentLookahead } from '@/lib/notifications/digest';
import { withSchedulerLease } from '@/lib/notifications/scheduler-lease';
import { runSweep } from '@/lib/notifications/sweeper';

export async function runSchedulerPass() {
  return withSchedulerLease(async () => {
    const now = new Date();
    await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } });
    const digested = await queueDailyDigest(now);
    const lookahead = await queueDepartmentLookahead(now);
    return { ...(await runSweep(now)), digested, lookahead };
  });
}
