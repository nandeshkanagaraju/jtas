/**
 * Demonstration data must never reach anybody's inbox.
 *
 * `pnpm seed:demo` generates a year of history so the dashboards have something
 * to aggregate, and most of it is overdue by construction. On the machine this
 * was written on that was 870 overdue subtasks, which the sweeper had already
 * turned into 1,740 notification rows — harmless against Mailpit, thousands of
 * real messages the day SMTP points at a relay.
 *
 * The fix is a column the queries filter on, not a worker somebody remembers to
 * stop, so this is the test that the filter actually holds.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queueDailyDigest } from '@/lib/notifications/digest';
import { buildDigestPayload } from '@/lib/notifications/payloads';
import { escalateOverdue, runSweep } from '@/lib/notifications/sweeper';
import { formatIST, fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { mailsOfType, restoreMail, sentMails, useCapturingMail } from './helpers/mail';

let production: Awaited<ReturnType<typeof createTestDepartment>>;
let realMember: Awaited<ReturnType<typeof createTestUser>>;
let demoMember: Awaited<ReturnType<typeof createTestUser>>;
let md: Awaited<ReturnType<typeof createTestUser>>;
let counter = 0;

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  counter = 0;
  useCapturingMail();

  production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  realMember = await createTestUser({
    email: 'ravi@jaraaglobal.com',
    departmentId: production.id,
  });
  demoMember = await createTestUser({
    email: 'production@demo.invalid',
    departmentId: production.id,
  });

  await testDb.setting.upsert({
    where: { key: 'suppress_reminders_outside_hours' },
    create: { key: 'suppress_reminders_outside_hours', value: false },
    update: { value: false },
  });
});

afterEach(() => restoreMail());

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

/** An overdue subtask on a job that is either demo or real. */
async function overdueSubtask(options: { isDemo: boolean; hoursLate?: number }) {
  counter++;

  const job = await testDb.job.create({
    data: {
      jobCode: options.isDemo ? `JGE-DEMO-${counter}` : `JGE-2026-${counter}`,
      title: options.isDemo ? 'Demo job' : 'Real job',
      overallDeadline: fromISTInput('2027-01-31T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
      isDemo: options.isDemo,
    },
  });

  return testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: production.id,
      assigneeId: options.isDemo ? demoMember.id : realMember.id,
      title: options.isDemo ? 'Demo machining' : 'Real machining',
      deadline: new Date(Date.now() - (options.hoursLate ?? 6) * 3_600_000),
      status: 'IN_PROGRESS',
    },
  });
}

const notificationsFor = (subtaskId: string) =>
  testDb.notification.count({ where: { entityType: 'SUBTASK', entityId: subtaskId } });

describe('the sweeper and demo jobs', () => {
  it('creates no notification rows for demo jobs while a real one escalates', async () => {
    const demo = await Promise.all(
      Array.from({ length: 25 }, () => overdueSubtask({ isDemo: true })),
    );
    const real = await overdueSubtask({ isDemo: false });

    const result = await runSweep();

    // The real one is chased exactly as before.
    expect(result.escalated).toBe(1);
    expect(await notificationsFor(real.id)).toBeGreaterThan(0);

    // The twenty-five demo ones produce nothing at all.
    const demoRows = await Promise.all(demo.map((subtask) => notificationsFor(subtask.id)));
    expect(demoRows).toEqual(Array(25).fill(0));

    const total = await testDb.notification.count({
      where: { entityId: { in: demo.map((subtask) => subtask.id) } },
    });
    expect(total).toBe(0);
  });

  it('sends no mail to a demo account', async () => {
    await overdueSubtask({ isDemo: true });
    await overdueSubtask({ isDemo: false });

    await runSweep();
    await runSweep(); // queue, then dispatch

    const recipients = sentMails().map((mail) => mail.to);

    expect(recipients.length).toBeGreaterThan(0);
    expect(recipients.some((to) => to.endsWith('@demo.invalid'))).toBe(false);
    expect(recipients).toContain(realMember.email);
  });

  it('escalates nothing at all when every overdue subtask is demo', async () => {
    for (let i = 0; i < 10; i++) await overdueSubtask({ isDemo: true });

    expect(await escalateOverdue()).toBe(0);
    expect(await testDb.notification.count()).toBe(0);
  });

  it('does not raise the MD’s escalation count on a demo subtask', async () => {
    const demo = await overdueSubtask({ isDemo: true });

    await escalateOverdue();
    await escalateOverdue(new Date(Date.now() + 8 * 3_600_000));

    // The counter is what the ladder climbs; leaving it at zero means a demo
    // job that is later flagged real starts from the beginning rather than
    // jumping to escalation three.
    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: demo.id } });
    expect(row.escalationCount).toBe(0);
    expect(row.lastEscalatedAt).toBeNull();
  });

  it('leaves the job status alone rather than marking a demo job DELAYED', async () => {
    const demo = await overdueSubtask({ isDemo: true });
    await escalateOverdue();

    const subtask = await testDb.subtask.findUniqueOrThrow({
      where: { id: demo.id },
      select: { job: { select: { status: true } } },
    });

    expect(subtask.job.status).toBe('IN_PROGRESS');
  });
});

describe('the daily digest and demo jobs', () => {
  beforeEach(() =>
    testDb.setting.upsert({
      where: { key: 'digest.time' },
      create: { key: 'digest.time', value: '09:00' },
      update: { value: '09:00' },
    }),
  );

  it('leaves demo work out of the MD’s morning mail', async () => {
    for (let i = 0; i < 5; i++) await overdueSubtask({ isDemo: true });
    const real = await overdueSubtask({ isDemo: false });

    const payload = await buildDigestPayload();

    expect(payload.kind).toBe('DAILY_DIGEST_MD');
    if (payload.kind !== 'DAILY_DIGEST_MD') throw new Error('unreachable');

    // Otherwise the digest is fixture data and the one piece of real overdue
    // work is pushed off the bottom of a fifty-row list.
    expect(payload.overdue).toHaveLength(1);
    expect(payload.overdue[0].subtaskTitle).toBe('Real machining');
    expect(payload.overdue.some((row) => row.jobCode.startsWith('JGE-DEMO'))).toBe(false);

    await testDb.subtask.findUniqueOrThrow({ where: { id: real.id } });
  });

  it('leaves a problem on a demo subtask out of the digest', async () => {
    const demo = await overdueSubtask({ isDemo: true });
    const real = await overdueSubtask({ isDemo: false });

    for (const subtask of [demo, real]) {
      await testDb.problem.create({
        data: {
          subtaskId: subtask.id,
          raisedById: realMember.id,
          description: 'Material short by twelve bars; supplier unconfirmed.',
          severity: 'HIGH',
          status: 'OPEN',
        },
      });
    }

    const payload = await buildDigestPayload();
    if (payload.kind !== 'DAILY_DIGEST_MD') throw new Error('unreachable');

    expect(payload.openProblems).toHaveLength(1);
    expect(payload.openProblems[0].jobCode.startsWith('JGE-DEMO')).toBe(false);
  });

  it('still queues and sends a digest to the MD', async () => {
    await overdueSubtask({ isDemo: false });

    /*
     * The digest window is anchored to `digest.time`, and the sweeper only
     * dispatches rows whose moment has come — so the setting is moved to now
     * rather than the row being queued for a date the sweeper will not reach.
     */
    const nowIst = formatIST(new Date(), 'HH:mm');
    await testDb.setting.update({ where: { key: 'digest.time' }, data: { value: nowIst } });

    expect(await queueDailyDigest()).toBe(1);

    await runSweep();

    const [digest] = mailsOfType('DAILY_DIGEST_MD');
    expect(digest, 'no digest was sent').toBeDefined();
    expect(digest.to).toBe(md.email);
    // The real overdue subtask is in it; the demo ones are not.
    expect(digest.body).toContain('Real machining');
    expect(digest.body).not.toContain('Demo machining');
  });
});
