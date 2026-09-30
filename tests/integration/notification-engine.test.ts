import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import { reminderKey } from '@/lib/notifications/dedupe';
import { dispatchDue, escalateOverdue } from '@/lib/notifications/sweeper';
import { createJob, publishJob } from '@/lib/services/jobs';
import { bulkCreateSubtasks, changeStatus } from '@/lib/services/subtasks';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { mailsOfType, restoreMail, useCapturingMail } from './helpers/mail';

const ctx = { ipAddress: '203.0.113.7' };

let md: SessionUser;
let mdActor: { id: string; role: 'MD' };
let member: SessionUser;
let planning: Awaited<ReturnType<typeof createTestDepartment>>;

/** Everything is anchored to a fixed, comfortably future instant. */
const DEADLINE_IST = '2027-06-10T18:00';
const DEADLINE = fromISTInput(DEADLINE_IST);
const LEAD_MINUTES = 360; // six hours

function session(user: {
  id: string;
  name: string;
  email: string;
  role: SessionUser['role'];
  departmentId: string | null;
}): SessionUser {
  return { ...user, isActive: true, mustChangePassword: false };
}

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  useCapturingMail();

  planning = await createTestDepartment({ code: 'PLANNING', name: 'Planning', sequenceOrder: 1 });

  const mdRow = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  md = session(mdRow);
  mdActor = { id: mdRow.id, role: 'MD' };

  member = session(
    await createTestUser({ email: 'planning@jaraaglobal.com', departmentId: planning.id }),
  );

  // Working hours off by default, so timing tests are about the clock rather
  // than the calendar. The suppression tests switch it back on explicitly.
  await testDb.setting.upsert({
    where: { key: 'suppress_reminders_outside_hours' },
    create: { key: 'suppress_reminders_outside_hours', value: false },
    update: { value: false },
  });
  for (const [key, value] of [
    ['escalation.interval_minutes', 240],
    ['escalation.max_count', 3],
  ] as const) {
    await testDb.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
});

afterEach(() => {
  restoreMail();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

/** A published job with one subtask due at `DEADLINE`. */
async function publishedSubtask(deadline = DEADLINE_IST) {
  const job = await createJob(
    {
      title: 'Spindle housing batch',
      partNumber: 'SH-4410',
      priority: 'NORMAL',
      overallDeadline: '2027-06-30T18:00',
    },
    mdActor,
    ctx,
  );

  const [subtask] = await bulkCreateSubtasks(
    job.id,
    {
      subtasks: [
        {
          departmentId: planning.id,
          assigneeId: member.id,
          title: 'Process plan and tooling list',
          deadline,
          reminderLeadMinutes: LEAD_MINUTES,
          requiresApproval: false,
        },
      ],
    },
    mdActor,
    ctx,
  );

  await publishJob(job, mdActor, ctx);
  return { job, subtask };
}

const pendingOf = (subtaskId: string, type: string) =>
  testDb.notification.findMany({
    where: { entityId: subtaskId, type: type as never, status: 'PENDING' },
  });

// ---------------------------------------------------------------------------
// Scheduling at publish (SDD 5.1)
// ---------------------------------------------------------------------------

describe('publishing a job schedules exactly what SDD 5.1 says', () => {
  it('creates one ASSIGNED and one REMINDER per subtask', async () => {
    const { subtask } = await publishedSubtask();

    const rows = await testDb.notification.findMany({ where: { entityId: subtask.id } });
    const byType = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.type] = (acc[row.type] ?? 0) + 1;
      return acc;
    }, {});

    expect(byType).toEqual({ SUBTASK_ASSIGNED: 1, DEADLINE_REMINDER: 1 });
    expect(rows.every((row) => row.userId === member.id)).toBe(true);
  });

  it('schedules the reminder at deadline minus the lead time', async () => {
    const { subtask } = await publishedSubtask();

    const [reminder] = await pendingOf(subtask.id, 'DEADLINE_REMINDER');
    const expected = new Date(DEADLINE.getTime() - LEAD_MINUTES * 60_000);

    expect(reminder.scheduledFor.toISOString()).toBe(expected.toISOString());
    expect(reminder.dedupeKey).toBe(reminderKey(subtask.id, DEADLINE));
  });

  it('publishing twice cannot double-schedule', async () => {
    const { job, subtask } = await publishedSubtask();

    // A second publish is refused, but even the scheduling call is idempotent.
    await expect(publishJob(job, mdActor, ctx)).rejects.toBeDefined();

    expect(await testDb.notification.count({ where: { entityId: subtask.id } })).toBe(2);
  });

  it('skips a reminder whose moment has already passed', async () => {
    /*
     * Deadline four hours out, lead six hours: the reminder is in the past.
     * The subtask is published with the usual far-future deadline and then
     * moved, because going through the service with a near-term one would make
     * the test depend on the wall clock — an earlier version built the deadline
     * string from today's date and failed after 6 PM IST.
     */
    const soon = new Date(Date.now() + 4 * 3_600_000);
    const { subtask } = await publishedSubtask();

    await testDb.notification.deleteMany({ where: { entityId: subtask.id } });
    await testDb.subtask.update({
      where: { id: subtask.id },
      data: { deadline: soon, reminderLeadMinutes: 360 },
    });

    const { scheduleForSubtask } = await import('@/lib/notifications/notification-service');
    await scheduleForSubtask(testDb, {
      id: subtask.id,
      assigneeId: member.id,
      deadline: soon,
      reminderLeadMinutes: 360,
    });

    // Firing it now would tell somebody their deadline is in six hours when it
    // is in four. The row is recorded as suppressed so the miss is visible.
    expect(await pendingOf(subtask.id, 'DEADLINE_REMINDER')).toHaveLength(0);
    const suppressed = await testDb.notification.findMany({
      where: { entityId: subtask.id, type: 'DEADLINE_REMINDER', status: 'SUPPRESSED' },
    });
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.lastError).toContain('Not scheduled');
    expect(await pendingOf(subtask.id, 'SUBTASK_ASSIGNED')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dispatch and idempotency (SDD 5.2 step 1)
// ---------------------------------------------------------------------------

describe('the reminder is sent once and only once', () => {
  it('sends at deadline minus six hours, and five more sweeps send nothing', async () => {
    const { subtask } = await publishedSubtask();

    const remindAt = new Date(DEADLINE.getTime() - LEAD_MINUTES * 60_000);

    // Clear the ASSIGNED row so the assertion is only about the reminder.
    await testDb.notification.deleteMany({
      where: { entityId: subtask.id, type: 'SUBTASK_ASSIGNED' },
    });

    await dispatchDue(remindAt);
    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(1);

    for (let i = 0; i < 5; i++) await dispatchDue(new Date(remindAt.getTime() + i * 60_000));

    // This is the property that matters: a sweeper that keeps running does not
    // keep mailing.
    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(1);
  });

  it('does not send before its moment', async () => {
    const { subtask } = await publishedSubtask();
    await testDb.notification.deleteMany({
      where: { entityId: subtask.id, type: 'SUBTASK_ASSIGNED' },
    });

    const tooEarly = new Date(DEADLINE.getTime() - (LEAD_MINUTES + 60) * 60_000);
    await dispatchDue(tooEarly);

    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(0);
  });

  it('records the real subject and marks the row SENT', async () => {
    const { subtask } = await publishedSubtask();
    await dispatchDue(new Date());

    const assigned = await testDb.notification.findFirstOrThrow({
      where: { entityId: subtask.id, type: 'SUBTASK_ASSIGNED' },
    });

    expect(assigned.status).toBe('SENT');
    expect(assigned.sentAt).not.toBeNull();
    expect(assigned.subject).toContain('[JTAS]');
    expect(assigned.subject).toContain('JGE-');
    expect(assigned.lastError).toContain('providerId:');
  });
});

// ---------------------------------------------------------------------------
// Overdue escalation (SDD 5.2 step 2)
// ---------------------------------------------------------------------------

describe('overdue escalation', () => {
  /** Moves a subtask's deadline into the past relative to `at`. */
  async function makeOverdue(subtaskId: string, at: Date, hoursLate: number) {
    await testDb.subtask.update({
      where: { id: subtaskId },
      data: { deadline: new Date(at.getTime() - hoursLate * 3_600_000) },
    });
  }

  it('queues one OVERDUE_MEMBER and one OVERDUE_MD per commander at +1 minute', async () => {
    const deputy = await createTestUser({ email: 'deputy@jaraaglobal.com', role: 'DEPUTY_MD' });
    const { subtask } = await publishedSubtask();

    const now = new Date();
    await makeOverdue(subtask.id, now, 0.02);

    expect(await escalateOverdue(now)).toBe(1);

    const member = await pendingOf(subtask.id, 'OVERDUE_MEMBER');
    const commanders = await pendingOf(subtask.id, 'OVERDUE_MD');

    expect(member).toHaveLength(1);
    // One row each for the MD and the deputy, so each can be read and retried
    // independently.
    expect(commanders).toHaveLength(2);
    expect(new Set(commanders.map((row) => row.userId))).toEqual(new Set([md.id, deputy.id]));
  });

  it('does not escalate again inside the interval, and does at +4h', async () => {
    const { subtask } = await publishedSubtask();
    const now = new Date();
    await makeOverdue(subtask.id, now, 1);

    expect(await escalateOverdue(now)).toBe(1);
    // Two hours later is inside the four-hour interval.
    expect(await escalateOverdue(new Date(now.getTime() + 2 * 3_600_000))).toBe(0);
    // Four hours later is not.
    expect(await escalateOverdue(new Date(now.getTime() + 4 * 3_600_000 + 60_000))).toBe(1);

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(row.escalationCount).toBe(2);
  });

  it('stops after escalation.max_count and never queues another row', async () => {
    const { subtask } = await publishedSubtask();
    const start = new Date();
    await makeOverdue(subtask.id, start, 1);

    for (let n = 0; n < 3; n++) {
      await escalateOverdue(new Date(start.getTime() + n * 5 * 3_600_000));
    }

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(row.escalationCount).toBe(3);

    // Days later, still nothing more. Unbounded mails train people to filter
    // them (improvement I-10).
    for (let n = 3; n < 8; n++) {
      expect(await escalateOverdue(new Date(start.getTime() + n * 5 * 3_600_000))).toBe(0);
    }
    expect(await pendingOf(subtask.id, 'OVERDUE_MEMBER')).toHaveLength(3);
  });

  it('sends no overdue mail at all for a subtask in PROBLEM', async () => {
    const { subtask } = await publishedSubtask();

    await changeStatus(
      subtask.id,
      {
        action: 'PROBLEM',
        note: 'Material short by 12 bars, supplier unconfirmed',
        severity: 'HIGH',
      },
      { id: member.id, role: 'MEMBER' },
      ctx,
    );

    const now = new Date();
    await makeOverdue(subtask.id, now, 10);

    // Improvement I-05: once a problem is on record the pressure moves to the
    // MD, and the member is not nagged.
    expect(await escalateOverdue(now)).toBe(0);
    expect(await pendingOf(subtask.id, 'OVERDUE_MEMBER')).toHaveLength(0);
  });

  it('sends no overdue mail for a completed, cancelled or held subtask', async () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'ON_HOLD'] as const) {
      const { subtask } = await publishedSubtask();
      const now = new Date();
      await testDb.subtask.update({
        where: { id: subtask.id },
        data: { status, deadline: new Date(now.getTime() - 10 * 3_600_000) },
      });

      expect(await escalateOverdue(now), status).toBe(0);
    }
  });

  it('sends no overdue mail when the job is on hold or cancelled (FR-14)', async () => {
    for (const status of ['ON_HOLD', 'CANCELLED'] as const) {
      const { job, subtask } = await publishedSubtask();
      const now = new Date();
      await makeOverdue(subtask.id, now, 10);
      await testDb.job.update({ where: { id: job.id }, data: { status } });

      expect(await escalateOverdue(now), status).toBe(0);
    }
  });

  it('marks the job DELAYED and writes an audit row', async () => {
    const { job, subtask } = await publishedSubtask();
    const now = new Date();
    await makeOverdue(subtask.id, now, 2);

    await escalateOverdue(now);

    expect((await testDb.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('DELAYED');

    const audit = await testDb.auditLog.findFirst({
      where: { entityId: subtask.id, action: 'SUBTASK_OVERDUE_ESCALATED' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.after).toMatchObject({ escalationCount: 1 });
  });

  it('running the escalator twice at the same instant queues nothing extra', async () => {
    const { subtask } = await publishedSubtask();
    const now = new Date();
    await makeOverdue(subtask.id, now, 1);

    await escalateOverdue(now);
    const before = await testDb.notification.count({ where: { entityId: subtask.id } });

    // The interval guard stops the second pass, and the dedupe key would stop
    // it even if the guard did not.
    await escalateOverdue(now);
    expect(await testDb.notification.count({ where: { entityId: subtask.id } })).toBe(before);
  });
});
