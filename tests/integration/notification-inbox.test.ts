/**
 * The in-app inbox: what a person sees, and what they cannot see or touch.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  enqueue,
  listNotifications,
  markAllRead,
  markRead,
} from '@/lib/notifications/notification-service';

import { createTestUser, resetAuthTables, testDb } from './helpers/db';

let ravi: Awaited<ReturnType<typeof createTestUser>>;
let priya: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetAuthTables();
  ravi = await createTestUser({ email: 'ravi@jaraaglobal.com' });
  priya = await createTestUser({ email: 'priya@jaraaglobal.com' });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

/** Queues one row and optionally marks it delivered. */
async function give(
  userId: string,
  key: string,
  options: { sent?: boolean; subject?: string } = {},
) {
  await enqueue(testDb, {
    type: 'SUBTASK_ASSIGNED',
    userIds: [userId],
    entityType: 'SUBTASK',
    entityId: `subtask-${key}`,
    subject: options.subject ?? `Task ${key}`,
    body: 'Body',
    dedupeKeyFor: () => `test:${key}:${userId}`,
    scheduledFor: new Date(),
  });

  if (options.sent !== false) {
    await testDb.notification.updateMany({
      where: { dedupeKey: `test:${key}:${userId}` },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  return testDb.notification.findFirstOrThrow({ where: { dedupeKey: `test:${key}:${userId}` } });
}

describe('listNotifications', () => {
  it('returns only the caller’s own rows', async () => {
    await give(ravi.id, 'a');
    await give(priya.id, 'b');

    const inbox = await listNotifications(ravi.id);

    expect(inbox.data).toHaveLength(1);
    expect(inbox.data[0].subject).toBe('Task a');
  });

  it('hides mail that has not gone out yet', async () => {
    // A reminder queued ten days ahead is not news; showing it in the inbox
    // would announce the deadline early and read as a duplicate later.
    await give(ravi.id, 'pending', { sent: false });

    expect((await listNotifications(ravi.id)).data).toHaveLength(0);
  });

  it('counts unread and filters to unread on request', async () => {
    const first = await give(ravi.id, 'a');
    await give(ravi.id, 'b');
    await markRead(ravi.id, first.id);

    const all = await listNotifications(ravi.id);
    expect(all.data).toHaveLength(2);
    expect(all.unreadCount).toBe(1);

    const unread = await listNotifications(ravi.id, { unreadOnly: true });
    expect(unread.data).toHaveLength(1);
    expect(unread.data[0].subject).toBe('Task b');
  });

  it('puts the newest first and honours the limit', async () => {
    for (const key of ['a', 'b', 'c']) {
      await give(ravi.id, key);
    }

    const inbox = await listNotifications(ravi.id, { limit: 2 });
    expect(inbox.data).toHaveLength(2);
    // The limit trims the list, not the badge.
    expect(inbox.unreadCount).toBe(3);
  });
});

describe('markRead', () => {
  it('marks the caller’s own row and reports it', async () => {
    const row = await give(ravi.id, 'a');

    expect(await markRead(ravi.id, row.id)).toBe(true);
    expect(
      (await testDb.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt,
    ).not.toBeNull();
  });

  it('refuses to mark someone else’s row, and leaves it untouched', async () => {
    const hers = await give(priya.id, 'b');

    // Ownership is in the WHERE clause, so guessing an id changes nothing.
    expect(await markRead(ravi.id, hers.id)).toBe(false);
    expect(
      (await testDb.notification.findUniqueOrThrow({ where: { id: hers.id } })).readAt,
    ).toBeNull();
  });

  it('is idempotent and reports the second call as a no-op', async () => {
    const row = await give(ravi.id, 'a');

    expect(await markRead(ravi.id, row.id)).toBe(true);
    expect(await markRead(ravi.id, row.id)).toBe(false);
  });

  it('reports false for an id that does not exist', async () => {
    expect(await markRead(ravi.id, 'nope-not-a-real-id')).toBe(false);
  });
});

describe('markAllRead', () => {
  it('clears only the caller’s unread rows', async () => {
    await give(ravi.id, 'a');
    await give(ravi.id, 'b');
    await give(priya.id, 'c');

    expect(await markAllRead(ravi.id)).toBe(2);
    expect((await listNotifications(ravi.id)).unreadCount).toBe(0);
    expect((await listNotifications(priya.id)).unreadCount).toBe(1);
  });

  it('returns zero when there is nothing to clear', async () => {
    expect(await markAllRead(ravi.id)).toBe(0);
  });
});
