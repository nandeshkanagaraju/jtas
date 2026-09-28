/**
 * Demonstration *people* must never be mailed, as demonstration *work* is never
 * chased.
 *
 * `Job.isDemo` and `tests/integration/demo-data-isolation.test.ts` cover the
 * second half. They do not cover this one, and the gap was live: recipients for
 * the digest, overdue escalations, approvals, extension requests and
 * job-completion mail are chosen by **role**, never by job, so a demo account
 * with role MD received all of them no matter what the job filter did. Both
 * `pnpm seed:demo` and `pnpm seed:showcase` create an MD, so on the machine
 * this was written on every escalation was addressed to three Managing
 * Directors and two of those addresses do not exist.
 *
 * The filter lives in `enqueue`, the only INSERT into "Notification" in the
 * codebase. These tests hold both halves of that claim: that the filter covers
 * every notification type there is, including ones added after this was
 * written, and that no second way to insert a row has appeared.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NotifType } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enqueue } from '@/lib/notifications/notification-service';
import { queueDailyDigest } from '@/lib/notifications/digest';
import { invalidateSettings } from '@/lib/services/settings';
import { problemRecipientIds } from '@/lib/services/notification-service';
import { formatIST } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { restoreMail, useCapturingMail } from './helpers/mail';

let realMd: Awaited<ReturnType<typeof createTestUser>>;
let demoMd: Awaited<ReturnType<typeof createTestUser>>;
let showcaseMd: Awaited<ReturnType<typeof createTestUser>>;
let demoMember: Awaited<ReturnType<typeof createTestUser>>;

beforeEach(async () => {
  await resetAuthTables();
  useCapturingMail();

  const production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });

  realMd = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  demoMd = await createTestUser({ email: 'md@demo.invalid', role: 'MD', isDemo: true });
  showcaseMd = await createTestUser({
    email: 'md@showcase.invalid',
    role: 'MD',
    isDemo: true,
  });
  demoMember = await createTestUser({
    email: 'production@demo.invalid',
    departmentId: production.id,
    isDemo: true,
  });
});

afterEach(() => {
  restoreMail();
});

describe('demo accounts never receive a notification row', () => {
  /**
   * The enum is the test's input, so a notification type added next year is
   * covered the day it is added — which is the only way this stays true. A new
   * `NotifType` that bypassed `enqueue` would fail here without anybody
   * remembering this file exists.
   */
  it.each(Object.values(NotifType))('drops demo recipients for %s', async (type) => {
    const created = await enqueue(testDb, {
      type,
      userIds: [realMd.id, demoMd.id, showcaseMd.id, demoMember.id],
      entityType: 'SUBTASK',
      entityId: `entity-${type}`,
      subject: 'subject',
      body: 'body',
      dedupeKeyFor: (userId) => `${type}:${userId}`,
    });

    // One row, for the one real person among four recipients.
    expect(created).toBe(1);

    const rows = await testDb.notification.findMany({
      where: { type },
      select: { userId: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(realMd.id);
  });

  it('creates nothing at all when every recipient is a demo account', async () => {
    const created = await enqueue(testDb, {
      type: 'OVERDUE_MD',
      userIds: [demoMd.id, showcaseMd.id, demoMember.id],
      entityType: 'SUBTASK',
      entityId: 'all-demo',
      subject: 'subject',
      body: 'body',
      dedupeKeyFor: (userId) => `all-demo:${userId}`,
    });

    expect(created).toBe(0);
    expect(await testDb.notification.count()).toBe(0);
  });

  /**
   * The three role-based recipient queries are the ones that leaked. They are
   * deliberately *not* filtered themselves — they still return the demo MDs —
   * because the filter belongs at the insert, not at each caller. What matters
   * is that what they return cannot become a row.
   */
  it('queues the digest for the real MD only, though three MDs are active', async () => {
    const recipients = await problemRecipientIds(testDb);
    expect(recipients).toHaveLength(3);

    /*
     * The window is anchored to `digest.time`, which other suites in this
     * worker's schema move (settings-service leaves it at 07:30). The setting
     * is pinned to the instant under test rather than assumed, and the cache
     * dropped, so this does not depend on which file ran first.
     */
    const inWindow = new Date('2026-09-28T03:45:00.000Z');
    await testDb.setting.upsert({
      where: { key: 'digest.time' },
      create: { key: 'digest.time', value: formatIST(inWindow, 'HH:mm') },
      update: { value: formatIST(inWindow, 'HH:mm') },
    });
    invalidateSettings();

    const created = await queueDailyDigest(inWindow);

    expect(created).toBe(1);

    const rows = await testDb.notification.findMany({
      where: { type: 'DAILY_DIGEST_MD' },
      select: { userId: true },
    });
    expect(rows.map((row) => row.userId)).toEqual([realMd.id]);
  });
});

describe('the filter cannot be bypassed', () => {
  /**
   * The guarantee above is worth exactly as much as the claim that `enqueue`
   * holds the only INSERT. This asserts that claim against the source itself,
   * so a second inserter fails the suite rather than quietly reopening the
   * hole. It greps tracked files only — a stray script in an ignored directory
   * is not shipped.
   */
  it('has no INSERT into "Notification" outside the notification service', () => {
    const root = join(__dirname, '..', '..');

    const tracked = execFileSync('git', ['ls-files', 'src', 'worker', 'scripts', 'prisma'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'));

    const owner = 'src/lib/notifications/notification-service.ts';
    const inserters = tracked.filter((path) => {
      if (path === owner) return false;
      const source = readFileSync(join(root, path), 'utf8');
      return (
        /INSERT\s+INTO\s+"Notification"/i.test(source) ||
        /\bnotification\s*\.\s*(create|createMany|upsert)\s*\(/.test(source)
      );
    });

    expect(inserters).toEqual([]);
  });
});
