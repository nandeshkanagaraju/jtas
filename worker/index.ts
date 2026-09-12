/**
 * JTAS background worker (SDD sections 1 and 5.2).
 *
 * A separate process from the web app for one reason: it must run on a clock
 * and stay restart-safe independently of request traffic. A silently dead
 * worker means no reminders and no overdue mails, so it stamps a heartbeat on
 * every tick and `/api/health` reports the age of that stamp (improvement I-15).
 *
 * The sweeper body itself lands in M7. What exists here is the process shell:
 * the tick loop, the heartbeat and graceful shutdown.
 */
import { prisma } from '@/lib/db/prisma';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('worker');

/** Settings key read back by `/api/health`. */
const HEARTBEAT_KEY = 'scheduler.heartbeat';

/** Records that the worker completed a pass, so a stall becomes observable. */
async function writeHeartbeat(): Promise<void> {
  const now = new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: HEARTBEAT_KEY },
    create: { key: HEARTBEAT_KEY, value: now },
    update: { value: now },
  });
}

/**
 * One sweeper pass. M7 fills this in with the two steps of SDD section 5.2:
 * dispatch due notification rows, then find newly overdue subtasks.
 */
async function tick(): Promise<void> {
  await writeHeartbeat();
}

async function main() {
  const { SCHEDULER_INTERVAL_MINUTES } = env();
  const intervalMs = SCHEDULER_INTERVAL_MINUTES * 60_000;

  log.info({ intervalMinutes: SCHEDULER_INTERVAL_MINUTES }, 'JTAS worker starting');

  // Run once immediately so a fresh deploy publishes a heartbeat without
  // waiting a full interval for the health check to go green.
  await runTick();

  // The interval is also what keeps the event loop alive; without a live handle
  // the process would exit the moment main() returned.
  const timer = setInterval(() => {
    void runTick();
  }, intervalMs);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'shutting down');
    clearInterval(timer);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Wraps `tick` so a failed pass logs and the loop survives. A transient
 * database blip must not take the scheduler down for good — the next tick
 * retries, and the stale heartbeat makes a persistent failure visible.
 */
async function runTick(): Promise<void> {
  const startedAt = Date.now();
  try {
    await tick();
    log.debug({ durationMs: Date.now() - startedAt }, 'sweeper tick complete');
  } catch (error) {
    log.error({ err: error }, 'sweeper tick failed; will retry on the next interval');
  }
}

main().catch((error) => {
  log.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
