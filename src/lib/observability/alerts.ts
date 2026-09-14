/**
 * The two things that make JTAS quietly stop working (SDD 10.4, M11.4).
 *
 * Neither shows up on a screen. A dead scheduler sends no reminders and no
 * escalations, and the product looks perfectly healthy while it does nothing;
 * a run of delivery failures looks identical from the inside. Improvement I-15
 * is explicit that this is the failure mode nobody notices for a week.
 *
 * The rules are pure and separately tested. Raising them is the impure part,
 * and lives below.
 */
import * as Sentry from '@sentry/nextjs';

import { logger } from '@/lib/utils/logger';

/** Older than this and the sweeper is presumed dead. */
export const STALE_HEARTBEAT_MINUTES = 20;

/** More failures than this in an hour is a broken channel, not bad luck. */
export const FAILED_PER_HOUR_LIMIT = 5;

export type AlertKey = 'scheduler-stale' | 'notifications-failing';

export interface Alert {
  key: AlertKey;
  message: string;
}

export interface SchedulerSignals {
  /** Null when the worker has never run — a fresh environment, not a fault. */
  heartbeatAgeSeconds: number | null;
  failedLastHour: number;
}

/**
 * Which alerts the current signals justify.
 *
 * A missing heartbeat is deliberately not an alert: a stack that has just come
 * up has no heartbeat yet, and crying wolf on every deploy is how an alert gets
 * muted for good.
 */
export function schedulerAlerts({
  heartbeatAgeSeconds,
  failedLastHour,
}: SchedulerSignals): Alert[] {
  const alerts: Alert[] = [];

  if (heartbeatAgeSeconds !== null && heartbeatAgeSeconds > STALE_HEARTBEAT_MINUTES * 60) {
    alerts.push({
      key: 'scheduler-stale',
      message:
        `The scheduler has not run for ${Math.round(heartbeatAgeSeconds / 60)} minutes. ` +
        'No reminders or overdue mails are going out.',
    });
  }

  if (failedLastHour > FAILED_PER_HOUR_LIMIT) {
    alerts.push({
      key: 'notifications-failing',
      message:
        `${failedLastHour} notifications failed in the last hour, over the limit of ` +
        `${FAILED_PER_HOUR_LIMIT}. Mail is probably not being delivered at all.`,
    });
  }

  return alerts;
}

/**
 * How long to stay quiet about an alert already raised.
 *
 * Caddy polls the health endpoint every fifteen seconds, so without this a dead
 * scheduler would produce four Sentry events a minute until somebody fixed it,
 * and the fix would arrive later for the noise.
 */
const COOLDOWN_MS = 15 * 60_000;

const lastRaised = new Map<AlertKey, number>();

/** Test seam — the cooldown is process state, and a test should not inherit it. */
export function resetAlertCooldown(): void {
  lastRaised.clear();
}

/**
 * Reports the alerts, at most once per cooldown each.
 *
 * Logged at error whether or not Sentry is configured: the log is the record
 * that survives, and a deployment without a DSN should still be diagnosable
 * from `docker compose logs`.
 *
 * Returns the alerts actually raised, so the caller can say what it did.
 */
export function raiseAlerts(alerts: Alert[], now = new Date()): Alert[] {
  const raised: Alert[] = [];

  for (const alert of alerts) {
    const previous = lastRaised.get(alert.key);
    if (previous !== undefined && now.getTime() - previous < COOLDOWN_MS) continue;

    lastRaised.set(alert.key, now.getTime());
    raised.push(alert);

    logger.error({ module: 'alerts', alert: alert.key }, alert.message);
    Sentry.captureMessage(alert.message, {
      level: 'error',
      tags: { alert: alert.key },
    });
  }

  return raised;
}
