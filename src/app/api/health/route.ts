/**
 * GET /api/health — SDD sections 6.2 and 10.4.
 *
 * The uptime check alerts on this. A silently dead scheduler means no overdue
 * mails, which would otherwise be invisible until somebody noticed nothing had
 * arrived for a week (improvement I-15) — so the heartbeat age is the headline
 * number, and a stale one makes the whole endpoint answer 503.
 */
import { NextResponse } from 'next/server';
import Redis from 'ioredis';

import { prisma } from '@/lib/db/prisma';
import { mailGuardConfig, quotaStatus, suppressedToday } from '@/lib/notifications/mail-guard';
import { raiseAlerts, schedulerAlerts, STALE_HEARTBEAT_MINUTES } from '@/lib/observability/alerts';
import { env } from '@/lib/utils/env';
import { minutesBetween } from '@/lib/utils/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_KEY = 'scheduler.heartbeat';

/** A ping must not hang the health check behind a dead Redis. */
const REDIS_TIMEOUT_MS = 1_500;

async function checkRedis(): Promise<boolean> {
  let client: Redis | null = null;

  try {
    client = new Redis(env().REDIS_URL, {
      lazyConnect: true,
      connectTimeout: REDIS_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client?.disconnect();
  }
}

export async function GET() {
  const checkedAt = new Date();

  let dbOk = true;
  let heartbeatAt: Date | null = null;
  let pendingNotifications = 0;
  let failedNotifications = 0;
  let failedLastHour = 0;
  let mailQuota: Awaited<ReturnType<typeof quotaStatus>> | null = null;
  let suppressedTodayCount = 0;

  try {
    // A trivial round trip proves the pool is alive, not just the process.
    await prisma.$queryRaw`SELECT 1`;

    const [heartbeat, pending, failed, recentlyFailed, quota, suppressed] = await Promise.all([
      prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } }),
      prisma.notification.count({ where: { status: 'PENDING' } }),
      prisma.notification.count({ where: { status: 'FAILED' } }),
      // The rate, not the total: a handful of dead addresses from last year
      // should not read as an outage today (M11.4).
      prisma.notification.count({
        where: {
          status: 'FAILED',
          failedAt: { gte: new Date(checkedAt.getTime() - 3_600_000) },
        },
      }),
      // The mail guards (M12): how much of today's allowance is left, and how
      // much the allowlist has withheld. Both are on the health endpoint
      // because both fail silently — a cap quietly reached and a roster
      // quietly off the list look identical from the outside: no mail.
      quotaStatus(prisma, mailGuardConfig().cap, checkedAt),
      suppressedToday(prisma, checkedAt),
    ]);

    if (heartbeat && typeof heartbeat.value === 'string') {
      const parsed = new Date(heartbeat.value);
      if (!Number.isNaN(parsed.getTime())) heartbeatAt = parsed;
    }

    pendingNotifications = pending;
    failedNotifications = failed;
    failedLastHour = recentlyFailed;
    mailQuota = quota;
    suppressedTodayCount = suppressed;
  } catch {
    dbOk = false;
  }

  const redisOk = await checkRedis();

  const schedulerHeartbeatAgeSeconds = heartbeatAt
    ? Math.round(minutesBetween(heartbeatAt, checkedAt) * 60)
    : null;

  /*
   * A missing heartbeat is not yet a failure: the worker may legitimately not
   * be running in a fresh environment. It becomes one once it has run and
   * stopped.
   */
  const schedulerOk =
    schedulerHeartbeatAgeSeconds === null ||
    schedulerHeartbeatAgeSeconds <= STALE_HEARTBEAT_MINUTES * 60;

  /*
   * Raise the two silent failures from here.
   *
   * This endpoint is the one thing guaranteed to run when the worker does not,
   * and Caddy polls it every fifteen seconds — so it is the natural watchdog
   * for a scheduler that has stopped. `raiseAlerts` holds a cooldown so that
   * frequency does not become the alert's own problem.
   */
  if (dbOk) {
    raiseAlerts(
      schedulerAlerts({ heartbeatAgeSeconds: schedulerHeartbeatAgeSeconds, failedLastHour }),
      checkedAt,
    );
  }

  const ok = dbOk && schedulerOk;

  return NextResponse.json(
    {
      ok,
      dbOk,
      redisOk,
      schedulerHeartbeatAgeSeconds,
      pendingNotifications,
      failedNotifications,
      failedLastHour,
      mailSentToday: mailQuota?.sentToday ?? null,
      mailDailyCap: mailQuota?.cap ?? null,
      mailQuotaRemaining: mailQuota?.remaining ?? null,
      mailQuotaResetsAt: mailQuota?.resetsAt.toISOString() ?? null,
      suppressedToday: suppressedTodayCount,
      checkedAt: checkedAt.toISOString(),
      staleAfterSeconds: STALE_HEARTBEAT_MINUTES * 60,
    },
    // Redis is not yet on the critical path — BullMQ is the minimal-cost
    // alternative the SDD leaves open, and the sweeper polls Postgres — so it
    // is reported but does not fail the check.
    { status: ok ? 200 : 503 },
  );
}
