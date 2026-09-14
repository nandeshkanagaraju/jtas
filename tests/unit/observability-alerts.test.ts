/**
 * The two silent failures (M11.4).
 *
 * These rules are the only thing standing between "the scheduler died" and
 * "nobody noticed for a week", so the boundaries are asserted exactly rather
 * than approximately.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FAILED_PER_HOUR_LIMIT,
  raiseAlerts,
  resetAlertCooldown,
  schedulerAlerts,
  STALE_HEARTBEAT_MINUTES,
} from '@/lib/observability/alerts';

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureMessage }));

const healthy = { heartbeatAgeSeconds: 60, failedLastHour: 0 };

describe('schedulerAlerts', () => {
  it('says nothing when the scheduler is alive and mail is going out', () => {
    expect(schedulerAlerts(healthy)).toEqual([]);
  });

  it('treats a missing heartbeat as a fresh environment, not a fault', () => {
    // A stack that has just come up has never run the sweeper. Alerting here
    // means an alert on every deploy, which is how an alert gets muted.
    expect(schedulerAlerts({ heartbeatAgeSeconds: null, failedLastHour: 0 })).toEqual([]);
  });

  it('is quiet at exactly the stale threshold and loud one second past it', () => {
    const at = STALE_HEARTBEAT_MINUTES * 60;

    expect(schedulerAlerts({ ...healthy, heartbeatAgeSeconds: at })).toEqual([]);
    expect(schedulerAlerts({ ...healthy, heartbeatAgeSeconds: at + 1 })).toHaveLength(1);
    expect(schedulerAlerts({ ...healthy, heartbeatAgeSeconds: at + 1 })[0].key).toBe(
      'scheduler-stale',
    );
  });

  it('is quiet at exactly the failure limit and loud one past it', () => {
    expect(schedulerAlerts({ ...healthy, failedLastHour: FAILED_PER_HOUR_LIMIT })).toEqual([]);

    const raised = schedulerAlerts({ ...healthy, failedLastHour: FAILED_PER_HOUR_LIMIT + 1 });
    expect(raised).toHaveLength(1);
    expect(raised[0].key).toBe('notifications-failing');
  });

  it('reports both when both are true', () => {
    const raised = schedulerAlerts({
      heartbeatAgeSeconds: STALE_HEARTBEAT_MINUTES * 60 + 600,
      failedLastHour: 50,
    });

    expect(raised.map((alert) => alert.key)).toEqual(['scheduler-stale', 'notifications-failing']);
  });

  it('names the numbers, so the alert is actionable without opening a dashboard', () => {
    const [alert] = schedulerAlerts({ ...healthy, heartbeatAgeSeconds: 45 * 60 });
    expect(alert.message).toContain('45 minutes');
  });
});

describe('raiseAlerts', () => {
  beforeEach(() => {
    resetAlertCooldown();
    captureMessage.mockClear();
  });

  it('reports an alert once and then holds its tongue', () => {
    const alerts = schedulerAlerts({ ...healthy, failedLastHour: 99 });
    const start = new Date('2026-09-14T10:00:00Z');

    expect(raiseAlerts(alerts, start)).toHaveLength(1);

    // Caddy polls the health endpoint every fifteen seconds. Without the
    // cooldown a dead scheduler would produce four events a minute.
    expect(raiseAlerts(alerts, new Date(start.getTime() + 15_000))).toHaveLength(0);
    expect(raiseAlerts(alerts, new Date(start.getTime() + 14 * 60_000))).toHaveLength(0);
    expect(raiseAlerts(alerts, new Date(start.getTime() + 16 * 60_000))).toHaveLength(1);

    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it('holds each alert separately', () => {
    const start = new Date('2026-09-14T10:00:00Z');

    raiseAlerts(schedulerAlerts({ ...healthy, failedLastHour: 99 }), start);

    // A different failure is news even though the first is still in cooldown.
    const both = raiseAlerts(
      schedulerAlerts({ heartbeatAgeSeconds: 9_999, failedLastHour: 99 }),
      new Date(start.getTime() + 60_000),
    );

    expect(both.map((alert) => alert.key)).toEqual(['scheduler-stale']);
  });
});
