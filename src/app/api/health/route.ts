/**
 * GET /api/health — public liveness probe (SDD section 6.2, 10.4).
 *
 * Reports database reachability and the age of the scheduler heartbeat. The
 * uptime check alerts when `scheduler.heartbeatAgeMinutes` exceeds 20, because
 * a silently dead scheduler means no overdue mails and would otherwise be
 * invisible (improvement I-15).
 */
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { minutesBetween } from '@/lib/utils/time';

export const dynamic = 'force-dynamic';

/** Settings key the worker stamps on every sweep. */
const HEARTBEAT_KEY = 'scheduler.heartbeat';

/** Beyond this, the scheduler is considered dead rather than merely late. */
const HEARTBEAT_STALE_MINUTES = 20;

export async function GET() {
  const checkedAt = new Date();

  let database: 'up' | 'down' = 'up';
  let heartbeatAt: Date | null = null;

  try {
    // A trivial round-trip proves the pool is alive, not just that the process is.
    await prisma.$queryRaw`SELECT 1`;

    const row = await prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } });
    if (row && typeof row.value === 'string') {
      const parsed = new Date(row.value);
      if (!Number.isNaN(parsed.getTime())) heartbeatAt = parsed;
    }
  } catch {
    database = 'down';
  }

  const heartbeatAgeMinutes = heartbeatAt
    ? Math.round(minutesBetween(heartbeatAt, checkedAt) * 10) / 10
    : null;

  // A missing heartbeat is not yet a failure: the worker may legitimately not
  // be running in a fresh environment. It becomes one once it has run and stopped.
  const schedulerHealthy =
    heartbeatAgeMinutes === null || heartbeatAgeMinutes <= HEARTBEAT_STALE_MINUTES;

  const healthy = database === 'up' && schedulerHealthy;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checkedAt: checkedAt.toISOString(),
      database,
      scheduler: {
        heartbeatAt: heartbeatAt?.toISOString() ?? null,
        heartbeatAgeMinutes,
        staleAfterMinutes: HEARTBEAT_STALE_MINUTES,
        healthy: schedulerHealthy,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
