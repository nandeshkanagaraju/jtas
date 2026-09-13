/**
 * The uptime check's contract. A silently dead scheduler sends no overdue mail,
 * and nobody notices until somebody asks why it has been quiet for a week
 * (improvement I-15) — so this endpoint has to go red on its own.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GET } from '@/app/api/health/route';
import { writeHeartbeat } from '@/lib/notifications/sweeper';

import { createTestUser, resetAuthTables, testDb } from './helpers/db';

interface HealthBody {
  ok: boolean;
  dbOk: boolean;
  redisOk: boolean;
  schedulerHeartbeatAgeSeconds: number | null;
  pendingNotifications: number;
  failedNotifications: number;
  staleAfterSeconds: number;
}

async function health() {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as HealthBody };
}

beforeEach(async () => {
  await resetAuthTables();
  await testDb.setting.deleteMany({ where: { key: 'scheduler.heartbeat' } });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('GET /api/health', () => {
  it('reports every field the operations runbook expects', async () => {
    await writeHeartbeat(testDb);
    const { status, body } = await health();

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      [
        'checkedAt',
        'dbOk',
        'failedNotifications',
        'ok',
        'pendingNotifications',
        'redisOk',
        'schedulerHeartbeatAgeSeconds',
        'staleAfterSeconds',
      ].sort(),
    );
    expect(body.ok).toBe(true);
    expect(body.dbOk).toBe(true);
    expect(body.schedulerHeartbeatAgeSeconds).toBeLessThan(5);
  });

  it('goes 503 once the heartbeat passes twenty minutes', async () => {
    await writeHeartbeat(testDb, new Date(Date.now() - 21 * 60_000));
    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    // Still green underneath, so whoever reads the alert knows it is the worker
    // and not the database.
    expect(body.dbOk).toBe(true);
    expect(body.schedulerHeartbeatAgeSeconds).toBeGreaterThan(body.staleAfterSeconds);
  });

  it('stays green just inside the window', async () => {
    await writeHeartbeat(testDb, new Date(Date.now() - 19 * 60_000));
    const { status } = await health();

    expect(status).toBe(200);
  });

  it('does not go red before the worker has ever run', async () => {
    // A fresh environment has no heartbeat yet. Failing here would mean the
    // check is red on every first deploy, which is how people learn to ignore
    // it.
    const { status, body } = await health();

    expect(status).toBe(200);
    expect(body.schedulerHeartbeatAgeSeconds).toBeNull();
  });

  it('counts the notification backlog', async () => {
    await writeHeartbeat(testDb);
    const user = await createTestUser({ email: 'ravi@jaraaglobal.com' });

    await testDb.notification.createMany({
      data: [
        {
          userId: user.id,
          type: 'SUBTASK_ASSIGNED',
          channel: 'EMAIL',
          subject: 'a',
          body: 'a',
          entityType: 'SUBTASK',
          entityId: 's1',
          dedupeKey: 'h:1',
          scheduledFor: new Date(),
          status: 'PENDING',
        },
        {
          userId: user.id,
          type: 'SUBTASK_ASSIGNED',
          channel: 'EMAIL',
          subject: 'b',
          body: 'b',
          entityType: 'SUBTASK',
          entityId: 's2',
          dedupeKey: 'h:2',
          scheduledFor: new Date(),
          status: 'FAILED',
        },
        {
          userId: user.id,
          type: 'SUBTASK_ASSIGNED',
          channel: 'EMAIL',
          subject: 'c',
          body: 'c',
          entityType: 'SUBTASK',
          entityId: 's3',
          dedupeKey: 'h:3',
          scheduledFor: new Date(),
          status: 'SENT',
        },
      ],
    });

    const { body } = await health();

    expect(body.pendingNotifications).toBe(1);
    expect(body.failedNotifications).toBe(1);
    // A growing FAILED count is the signal that mail is broken; SENT is not a
    // backlog and must not inflate either number.
  });
});
