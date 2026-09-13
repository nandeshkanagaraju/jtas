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
import { env } from '@/lib/utils/env';
import { minutesBetween } from '@/lib/utils/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_KEY = 'scheduler.heartbeat';

/** SDD 10.4: alert if the heartbeat is older than twenty minutes. */
const HEARTBEAT_STALE_MINUTES = 20;

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

  try {
    // A trivial round trip proves the pool is alive, not just the process.
    await prisma.$queryRaw`SELECT 1`;

    const [heartbeat, pending, failed] = await Promise.all([
      prisma.setting.findUnique({ where: { key: HEARTBEAT_KEY } }),
      prisma.notification.count({ where: { status: 'PENDING' } }),
      prisma.notification.count({ where: { status: 'FAILED' } }),
    ]);

    if (heartbeat && typeof heartbeat.value === 'string') {
      const parsed = new Date(heartbeat.value);
      if (!Number.isNaN(parsed.getTime())) heartbeatAt = parsed;
    }

    pendingNotifications = pending;
    failedNotifications = failed;
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
    schedulerHeartbeatAgeSeconds <= HEARTBEAT_STALE_MINUTES * 60;

  const ok = dbOk && schedulerOk;

  return NextResponse.json(
    {
      ok,
      dbOk,
      redisOk,
      schedulerHeartbeatAgeSeconds,
      pendingNotifications,
      failedNotifications,
      checkedAt: checkedAt.toISOString(),
      staleAfterSeconds: HEARTBEAT_STALE_MINUTES * 60,
    },
    // Redis is not yet on the critical path — BullMQ is the minimal-cost
    // alternative the SDD leaves open, and the sweeper polls Postgres — so it
    // is reported but does not fail the check.
    { status: ok ? 200 : 503 },
  );
}
