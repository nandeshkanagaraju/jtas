/**
 * The second half of the M7 definition of done: what happens to scheduled mail
 * when the work underneath it changes, when the sweeper dies mid-batch, and
 * when the clock is outside working hours.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PermanentChannelError } from '@/lib/notifications/channels';
import { reminderKey } from '@/lib/notifications/dedupe';
import { queueDailyDigest } from '@/lib/notifications/digest';
import { dispatchDue, escalateOverdue, runSweep, MAX_ATTEMPTS } from '@/lib/notifications/sweeper';
import { createJob, publishJob } from '@/lib/services/jobs';
import { bulkCreateSubtasks, changeDeadline, changeStatus } from '@/lib/services/subtasks';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import {
  clearMails,
  failNextSends,
  mailsOfType,
  restoreMail,
  sentMails,
  useCapturingMail,
} from './helpers/mail';

const ctx = { ipAddress: '203.0.113.7' };
const LEAD_MINUTES = 360;

let mdActor: { id: string; role: 'MD' };
let memberActor: { id: string; role: 'MEMBER' };
let planning: Awaited<ReturnType<typeof createTestDepartment>>;

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  useCapturingMail();

  planning = await createTestDepartment({ code: 'PLANNING', name: 'Planning', sequenceOrder: 1 });
  const md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  mdActor = { id: md.id, role: 'MD' };
  const member = await createTestUser({
    email: 'planning@jaraaglobal.com',
    departmentId: planning.id,
  });
  memberActor = { id: member.id, role: 'MEMBER' };

  await setSettings({
    suppress_reminders_outside_hours: false,
    'escalation.interval_minutes': 240,
    'escalation.max_count': 3,
  });
});

afterEach(() => restoreMail());

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

async function setSettings(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    await testDb.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
  }
}

async function publishedSubtask(deadline = '2027-06-10T18:00') {
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
          assigneeId: memberActor.id,
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

const remindersFor = (subtaskId: string) =>
  testDb.notification.findMany({
    where: { entityId: subtaskId, type: 'DEADLINE_REMINDER' },
    orderBy: { createdAt: 'asc' },
  });

// ---------------------------------------------------------------------------

describe('extending a deadline moves the reminder with it', () => {
  it('drops the old pending reminder and schedules a new one', async () => {
    const { subtask } = await publishedSubtask();
    const original = fromISTInput('2027-06-10T18:00');
    const extended = fromISTInput('2027-06-14T18:00');

    await changeDeadline(
      subtask.id,
      { newDeadline: '2027-06-14T18:00', reason: 'Tool steel delivery slipped by four days' },
      mdActor,
      ctx,
    );

    const rows = await remindersFor(subtask.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBe(reminderKey(subtask.id, extended));
    expect(rows[0].scheduledFor.toISOString()).toBe(
      new Date(extended.getTime() - LEAD_MINUTES * 60_000).toISOString(),
    );

    // The old key is gone, so nothing can fire on the old date.
    const stale = await testDb.notification.findFirst({
      where: { dedupeKey: reminderKey(subtask.id, original) },
    });
    expect(stale).toBeNull();
  });

  it('never fires the old reminder even if the sweeper reaches its moment', async () => {
    const { subtask } = await publishedSubtask();
    await changeDeadline(
      subtask.id,
      { newDeadline: '2027-06-14T18:00', reason: 'Tool steel delivery slipped by four days' },
      mdActor,
      ctx,
    );
    clearMails();

    // Sweep right through the original reminder moment.
    await dispatchDue(new Date(fromISTInput('2027-06-10T18:00').getTime() - 60_000));
    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(0);

    // And then at the new one, where it does arrive.
    await dispatchDue(new Date(fromISTInput('2027-06-14T18:00').getTime()));
    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(1);
  });

  it('resets escalationCount so a re-agreed date starts clean', async () => {
    const { subtask } = await publishedSubtask();
    const now = new Date();

    await testDb.subtask.update({
      where: { id: subtask.id },
      data: { deadline: new Date(now.getTime() - 3_600_000) },
    });
    await escalateOverdue(now);
    expect(
      (await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } })).escalationCount,
    ).toBe(1);

    await changeDeadline(
      subtask.id,
      { newDeadline: '2027-06-14T18:00', reason: 'Re-agreed with the customer this morning' },
      mdActor,
      ctx,
    );

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    // Otherwise the very first sweep after the new date would jump straight to
    // escalation two.
    expect(row.escalationCount).toBe(0);
  });

  it('tells the assignee, and keeps mails already sent as history', async () => {
    const { subtask } = await publishedSubtask();
    await dispatchDue(new Date()); // the ASSIGNED mail goes out
    const sentBefore = sentMails().length;

    await changeDeadline(
      subtask.id,
      { newDeadline: '2027-06-14T18:00', reason: 'Tool steel delivery slipped by four days' },
      mdActor,
      ctx,
    );

    await dispatchDue(new Date());
    expect(mailsOfType('DEADLINE_CHANGED')).toHaveLength(1);
    expect(sentMails().length).toBe(sentBefore + 1);

    // The already-sent assignment is untouched — cancelling scheduled mail must
    // never rewrite the record of what was actually delivered.
    const assigned = await testDb.notification.findFirstOrThrow({
      where: { entityId: subtask.id, type: 'SUBTASK_ASSIGNED' },
    });
    expect(assigned.status).toBe('SENT');
  });
});

describe('finishing early stops the chasing', () => {
  it('sends neither reminder nor overdue once the subtask is COMPLETED', async () => {
    const { subtask } = await publishedSubtask();

    await changeStatus(subtask.id, { action: 'START' }, memberActor, ctx);
    await changeStatus(
      subtask.id,
      { action: 'COMPLETE', note: 'Process plan issued and tooling list released' },
      memberActor,
      ctx,
    );
    clearMails();

    // Well past both the reminder moment and the deadline.
    await dispatchDue(fromISTInput('2027-06-11T18:00'));
    await escalateOverdue(fromISTInput('2027-06-11T18:00'));

    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(0);
    expect(mailsOfType('OVERDUE_MEMBER')).toHaveLength(0);
    expect(mailsOfType('OVERDUE_MD')).toHaveLength(0);
    expect(await remindersFor(subtask.id)).toHaveLength(0);
  });

  it('also stops chasing a cancelled subtask', async () => {
    const { subtask } = await publishedSubtask();
    await changeStatus(
      subtask.id,
      { action: 'CANCEL', note: 'Customer withdrew this line item' },
      mdActor,
      ctx,
    );
    clearMails();

    await dispatchDue(fromISTInput('2027-06-11T18:00'));
    expect(mailsOfType('DEADLINE_REMINDER')).toHaveLength(0);
  });
});

describe('a sweeper that dies mid-batch', () => {
  it('resends nothing when it restarts', async () => {
    for (let i = 0; i < 3; i++) await publishedSubtask();

    // First pass: the third send dies, standing in for the process being killed
    // between SMTP accepting the mail and the row being marked.
    failNextSends(1);
    const first = await dispatchDue(new Date());
    expect(first.dispatched).toBe(2);
    expect(first.failed).toBe(1);

    const sentInFirstPass = sentMails().length;

    // Restart: the two marked rows are not touched again, and the failed one is
    // waiting on its backoff.
    const second = await dispatchDue(new Date());
    expect(second.dispatched).toBe(0);
    expect(sentMails().length).toBe(sentInFirstPass);

    // After the backoff the failed row alone goes out.
    const later = new Date(Date.now() + 5 * 60_000);
    const third = await dispatchDue(later);
    expect(third.dispatched).toBe(1);
    expect(sentMails().length).toBe(sentInFirstPass + 1);
  });

  it('gives up after five attempts rather than retrying forever', async () => {
    await publishedSubtask();

    failNextSends(MAX_ATTEMPTS);
    let at = new Date();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await dispatchDue(at);
      at = new Date(at.getTime() + 60 * 60_000);
    }

    const row = await testDb.notification.findFirstOrThrow({ where: { type: 'SUBTASK_ASSIGNED' } });
    expect(row.status).toBe('FAILED');
    expect(row.attemptCount).toBe(MAX_ATTEMPTS);

    // A FAILED row is never picked up again — it is a thing to look at, not a
    // thing to keep trying.
    expect((await dispatchDue(new Date(at.getTime() + 86_400_000))).dispatched).toBe(0);
  });

  it('fails a permanently rejected address immediately', async () => {
    await publishedSubtask();

    // What the real email channel raises for an SMTP 5xx; its own
    // classification of response codes is covered in tests/unit.
    failNextSends(1, () => new PermanentChannelError('550 5.1.1 No such mailbox'));

    await dispatchDue(new Date());

    const row = await testDb.notification.findFirstOrThrow({ where: { type: 'SUBTASK_ASSIGNED' } });
    // Retrying a bad address five times only buries the real failures.
    expect(row.status).toBe('FAILED');
    expect(row.attemptCount).toBe(1);
  });
});

describe('working hours (SDD 5.3)', () => {
  beforeEach(async () => {
    await setSettings({
      suppress_reminders_outside_hours: true,
      'working_hours.start': '09:00',
      'working_hours.end': '18:00',
      working_days: [1, 2, 3, 4, 5, 6],
    });
    await testDb.holiday.deleteMany();
  });

  it('shifts a 2 AM reminder to 9 AM', async () => {
    await publishedSubtask();
    const twoAm = fromISTInput('2027-06-10T02:00'); // a Thursday

    const result = await dispatchDue(twoAm);

    expect(result.deferred).toBe(1);
    expect(result.dispatched).toBe(0);

    const row = await testDb.notification.findFirstOrThrow({ where: { type: 'SUBTASK_ASSIGNED' } });
    expect(row.scheduledFor.toISOString()).toBe(fromISTInput('2027-06-10T09:00').toISOString());

    // And at nine it actually goes.
    await dispatchDue(fromISTInput('2027-06-10T09:00'));
    expect(mailsOfType('SUBTASK_ASSIGNED')).toHaveLength(1);
  });

  it('sends an overdue mail at 2 AM without shifting it', async () => {
    const { subtask } = await publishedSubtask();
    const twoAm = fromISTInput('2027-06-10T02:00');

    await testDb.notification.deleteMany({});
    await testDb.subtask.update({
      where: { id: subtask.id },
      data: { deadline: fromISTInput('2027-06-09T18:00') },
    });

    await escalateOverdue(twoAm);
    const result = await dispatchDue(twoAm);

    // A missed deadline is news whenever it happens; holding it until morning
    // is how a delay becomes a surprise.
    expect(result.deferred).toBe(0);
    expect(mailsOfType('OVERDUE_MEMBER')).toHaveLength(1);
    expect(mailsOfType('OVERDUE_MD')).toHaveLength(1);
  });

  it('pushes a Sunday reminder to Monday morning', async () => {
    await publishedSubtask();
    const sunday = fromISTInput('2027-06-13T11:00');

    await dispatchDue(sunday);

    const row = await testDb.notification.findFirstOrThrow({ where: { type: 'SUBTASK_ASSIGNED' } });
    expect(row.scheduledFor.toISOString()).toBe(fromISTInput('2027-06-14T09:00').toISOString());
  });

  it('skips a declared holiday', async () => {
    await testDb.holiday.create({
      data: { date: fromISTInput('2027-06-10T00:00'), name: 'Factory shutdown' },
    });
    await publishedSubtask();

    await dispatchDue(fromISTInput('2027-06-10T11:00'));

    const row = await testDb.notification.findFirstOrThrow({ where: { type: 'SUBTASK_ASSIGNED' } });
    expect(row.scheduledFor.toISOString()).toBe(fromISTInput('2027-06-11T09:00').toISOString());
  });
});

describe('the daily digest', () => {
  beforeEach(() => setSettings({ 'digest.time': '09:00' }));

  it('queues one row per commander inside the window and nothing outside it', async () => {
    await createTestUser({ email: 'deputy@jaraaglobal.com', role: 'DEPUTY_MD' });

    expect(await queueDailyDigest(fromISTInput('2027-06-10T14:00'))).toBe(0);

    expect(await queueDailyDigest(fromISTInput('2027-06-10T09:05'))).toBe(2);
    // A sweeper running every five minutes hits the window a dozen times.
    expect(await queueDailyDigest(fromISTInput('2027-06-10T09:35'))).toBe(0);

    // Tomorrow is a different date key, so it queues again.
    expect(await queueDailyDigest(fromISTInput('2027-06-11T09:05'))).toBe(2);
  });

  it('renders and sends', async () => {
    await queueDailyDigest(fromISTInput('2027-06-10T09:05'));
    await dispatchDue(fromISTInput('2027-06-10T09:05'));

    const [mail] = mailsOfType('DAILY_DIGEST_MD');
    expect(mail.subject).toContain('Daily summary');
    expect(mail.html).toContain('<html');
    expect(mail.body.length).toBeGreaterThan(50);
  });
});

describe('runSweep', () => {
  it('does both steps and leaves a fresh heartbeat', async () => {
    const { subtask } = await publishedSubtask();
    const now = new Date();
    await testDb.subtask.update({
      where: { id: subtask.id },
      data: { deadline: new Date(now.getTime() - 3_600_000) },
    });

    const result = await runSweep(now);

    expect(result.escalated).toBe(1);
    expect(result.dispatched).toBeGreaterThan(0);

    const heartbeat = await testDb.setting.findUniqueOrThrow({
      where: { key: 'scheduler.heartbeat' },
    });
    expect(new Date(String(heartbeat.value)).getTime()).toBeGreaterThanOrEqual(
      now.getTime() - 1000,
    );
  });
});
