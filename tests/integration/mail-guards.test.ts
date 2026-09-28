/**
 * The allowlist and the daily cap, exercised through the real sweeper.
 *
 * Both guards exist for the same reason and fail in the same direction: the
 * moment the provider is a real relay rather than Mailpit, a mistake is
 * unrecoverable. So neither is tested by calling the guard directly — they are
 * tested by running `dispatchDue` over rows in the database and asserting on
 * what the capturing channel actually received.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enqueue, listNotifications } from '@/lib/notifications/notification-service';
import { dispatchDue } from '@/lib/notifications/sweeper';
import { startOfNextISTDay } from '@/lib/utils/time';

import {
  createTestDepartment,
  createTestSubtask,
  createTestUser,
  resetAuthTables,
  testDb,
} from './helpers/db';
import { restoreMail, sentMails, useCapturingMail } from './helpers/mail';

const ALLOWED = 'you@example.com';
const TAGGED = 'you+hr@example.com';

let allowed: Awaited<ReturnType<typeof createTestUser>>;
let offList: Awaited<ReturnType<typeof createTestUser>>;
let tagged: Awaited<ReturnType<typeof createTestUser>>;
let department: Awaited<ReturnType<typeof createTestDepartment>>;

/** Queues one due EMAIL row for a user and returns its id. */
async function queueFor(user: { id: string }, key: string): Promise<string> {
  const subtask = await createTestSubtask({
    assigneeId: user.id,
    departmentId: department.id,
  });

  await enqueue(testDb, {
    type: 'DEADLINE_REMINDER',
    userIds: [user.id],
    entityType: 'SUBTASK',
    entityId: subtask.id,
    subject: 'queued',
    body: 'queued',
    dedupeKeyFor: (userId) => `${key}:${userId}`,
    scheduledFor: new Date(Date.now() - 60_000),
  });

  const row = await testDb.notification.findFirstOrThrow({
    where: { userId: user.id, entityId: subtask.id },
  });
  return row.id;
}

beforeEach(async () => {
  await resetAuthTables();
  useCapturingMail();

  // Assigned, never deleted: under Vitest a `delete` on process.env does not
  // take effect, so a deleting teardown leaves the guard live for every file
  // that runs after this one.
  process.env.MAIL_ALLOWLIST = '';
  process.env.MAIL_DAILY_CAP = '250';

  department = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
  allowed = await createTestUser({ email: ALLOWED, departmentId: department.id });
  offList = await createTestUser({ email: 'hr@jaraaglobal.com', departmentId: department.id });
  tagged = await createTestUser({ email: TAGGED, departmentId: department.id });
});

afterEach(() => {
  restoreMail();
  process.env.MAIL_ALLOWLIST = '';
  process.env.MAIL_DAILY_CAP = '250';
});

describe('the recipient allowlist', () => {
  beforeEach(() => {
    process.env.MAIL_ALLOWLIST = ALLOWED;
  });

  it('delivers to an allowlisted address', async () => {
    await queueFor(allowed, 'ok');

    const result = await dispatchDue();

    expect(result.dispatched).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(sentMails().map((mail) => mail.to)).toEqual([ALLOWED]);
  });

  it('suppresses a recipient who is not on the list, and sends nothing', async () => {
    const id = await queueFor(offList, 'off');

    const result = await dispatchDue();

    expect(result.suppressed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(sentMails()).toEqual([]);

    const row = await testDb.notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUPPRESSED');
    // Not FAILED, and never marked sent — the daily cap counts on sentAt.
    expect(row.sentAt).toBeNull();
    expect(row.lastError).toContain('hr@jaraaglobal.com');
    expect(row.lastError).toContain('MAIL_ALLOWLIST');
  });

  it('leaves the suppressed row visible in the in-app inbox, with its reason', async () => {
    await queueFor(offList, 'inbox');
    await dispatchDue();

    const { data } = await listNotifications(offList.id);

    expect(data).toHaveLength(1);
    expect(data[0].suppressedReason).toContain('not on MAIL_ALLOWLIST');
    // The rendered message is kept, so the screen shows what would have gone.
    expect(data[0].subject.length).toBeGreaterThan(0);
  });

  it('does not expose a provider id as a suppression reason on a sent row', async () => {
    await queueFor(allowed, 'sent');
    await dispatchDue();

    const { data } = await listNotifications(allowed.id);
    expect(data[0].suppressedReason).toBeNull();
  });

  /**
   * The plus-tag case, end to end. `+hr@` is a real, deliverable mailbox that
   * Gmail routes to the same inbox as the allowlisted address — so a matcher
   * that normalised it would mail an address nobody put on the list.
   */
  it('suppresses a plus-tagged address that is not itself listed', async () => {
    const id = await queueFor(tagged, 'tagged');

    const result = await dispatchDue();

    expect(result.suppressed).toBe(1);
    expect(sentMails()).toEqual([]);

    const row = await testDb.notification.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUPPRESSED');
    expect(row.lastError).toContain(TAGGED);
  });

  it('delivers to the plus-tagged address once it is listed explicitly', async () => {
    process.env.MAIL_ALLOWLIST = `${ALLOWED},${TAGGED}`;
    await queueFor(tagged, 'tagged-ok');

    const result = await dispatchDue();

    expect(result.dispatched).toBe(1);
    expect(sentMails().map((mail) => mail.to)).toEqual([TAGGED]);
  });

  it('applies to every recipient in one pass, not just the first', async () => {
    await queueFor(allowed, 'mixed-a');
    await queueFor(offList, 'mixed-b');
    await queueFor(tagged, 'mixed-c');

    const result = await dispatchDue();

    expect(result.dispatched).toBe(1);
    expect(result.suppressed).toBe(2);
    expect(sentMails().map((mail) => mail.to)).toEqual([ALLOWED]);
  });
});

describe('the daily cap', () => {
  beforeEach(() => {
    process.env.MAIL_ALLOWLIST = ALLOWED;
    process.env.MAIL_DAILY_CAP = '2';
  });

  it('stops at the cap and leaves the rest PENDING, not FAILED', async () => {
    const ids = [
      await queueFor(allowed, 'cap-1'),
      await queueFor(allowed, 'cap-2'),
      await queueFor(allowed, 'cap-3'),
      await queueFor(allowed, 'cap-4'),
    ];

    const result = await dispatchDue();

    expect(result.dispatched).toBe(2);
    expect(result.quotaHeld).toBe(2);
    expect(sentMails()).toHaveLength(2);

    const rows = await testDb.notification.findMany({
      where: { id: { in: ids } },
      select: { status: true, attemptCount: true },
    });

    expect(rows.filter((row) => row.status === 'SENT')).toHaveLength(2);

    const held = rows.filter((row) => row.status === 'PENDING');
    expect(held).toHaveLength(2);
    // Untouched: a held row must not burn a retry attempt.
    expect(held.every((row) => row.attemptCount === 0)).toBe(true);
  });

  it('a second pass in the same IST day sends nothing more', async () => {
    for (const key of ['a', 'b', 'c']) await queueFor(allowed, `same-day-${key}`);

    expect((await dispatchDue()).dispatched).toBe(2);

    const second = await dispatchDue();
    expect(second.dispatched).toBe(0);
    expect(second.quotaHeld).toBe(1);
    expect(sentMails()).toHaveLength(2);
  });

  /**
   * The rollover. The cap counts sends inside the current IST day, so the held
   * row goes out on the first pass after midnight — without anybody requeueing
   * it, and without it having been marked failed in the meantime.
   */
  it('dispatches the held row after an IST midnight rollover', async () => {
    for (const key of ['a', 'b', 'c']) await queueFor(allowed, `rollover-${key}`);

    await dispatchDue();
    expect(sentMails()).toHaveLength(2);

    // One second past the next IST midnight.
    const tomorrow = new Date(startOfNextISTDay(new Date()).getTime() + 1_000);
    const result = await dispatchDue(tomorrow);

    expect(result.dispatched).toBe(1);
    expect(result.quotaHeld).toBe(0);
    expect(sentMails()).toHaveLength(3);

    expect(await testDb.notification.count({ where: { status: 'PENDING' } })).toBe(0);
  });

  it('does not count a suppressed row against the cap', async () => {
    // Two suppressed, then two allowed: the allowed pair must still go out.
    await queueFor(offList, 'not-counted-1');
    await queueFor(offList, 'not-counted-2');
    await queueFor(allowed, 'counted-1');
    await queueFor(allowed, 'counted-2');

    const result = await dispatchDue();

    expect(result.suppressed).toBe(2);
    expect(result.dispatched).toBe(2);
    expect(result.quotaHeld).toBe(0);
  });
});
