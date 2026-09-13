/**
 * The JTAS worker — SDD sections 1 and 5.2.
 *
 * A separate process from the web app for one reason: it must run on a clock
 * and stay restart-safe independently of request traffic. A silently dead
 * worker means no reminders and no overdue mails, which is the failure the
 * whole product is built to prevent — so it stamps a heartbeat on every pass
 * and `/api/health` reports the age of that stamp (improvement I-15).
 *
 * Run with: pnpm worker
 */
import { prisma } from '@/lib/db/prisma';
import { queueDailyDigest } from '@/lib/notifications/digest';
import { runSweep } from '@/lib/notifications/sweeper';
import { env } from '@/lib/utils/env';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('worker');

/** Set while a pass is running, so shutdown can wait for it. */
let inFlight: Promise<void> | null = null;
let shuttingDown = false;

/**
 * One pass: dispatch what is due, escalate what is overdue, queue the digest if
 * this is its window, and stamp the heartbeat.
 *
 * Wrapped so a failed pass logs and the loop survives. A transient database
 * blip must not take the scheduler down for good — the next tick retries, and a
 * persistent failure shows up as a stale heartbeat.
 */
async function tick(): Promise<void> {
  const startedAt = Date.now();

  try {
    const now = new Date();
    const digested = await queueDailyDigest(now);
    const result = await runSweep(now);

    const total =
      result.dispatched + result.deferred + result.failed + result.dropped + result.escalated;

    // Only log a pass that did something; a quiet five-minute tick should not
    // fill the log it would otherwise be searched in.
    if (total > 0 || digested > 0) {
      log.info({ ...result, digested, durationMs: Date.now() - startedAt }, 'sweep complete');
    } else {
      log.debug({ durationMs: Date.now() - startedAt }, 'sweep complete, nothing to do');
    }
  } catch (error) {
    log.error({ err: error }, 'sweep failed; will retry on the next interval');
  }
}

/** Runs a pass unless one is already running, and tracks it for shutdown. */
async function runTick(): Promise<void> {
  if (inFlight || shuttingDown) {
    log.warn('previous sweep still running; skipping this interval');
    return;
  }

  inFlight = tick().finally(() => {
    inFlight = null;
  });

  await inFlight;
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

  /**
   * Graceful shutdown: stop scheduling, let the in-flight batch finish, then
   * close the pool. Killing mid-batch would be safe — the dedupe keys see to
   * that — but finishing means no row is left claimed and unsent.
   */
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal, waitingForBatch: inFlight !== null }, 'shutting down');
    clearInterval(timer);

    if (inFlight) {
      await Promise.race([
        inFlight,
        // A batch that will not finish must not hold the process open forever;
        // whatever it had claimed is retried on the next start.
        new Promise((resolve) => setTimeout(resolve, 30_000)),
      ]);
    }

    await prisma.$disconnect().catch(() => {});
    log.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  log.error({ err: error }, 'worker failed to start');
  process.exit(1);
});
