/**
 * Time-travelled notification assertions (build spec M11.1).
 *
 * "Assert the reminder and both overdue mails were generated with the right
 * recipients, subjects and dedupe keys."
 *
 * The clock is not moved — the *deadline* is. Moving a deadline into the past
 * and running the sweeper at a known instant is the same arithmetic with none
 * of the fragility of a faked system clock, which Postgres and the Node process
 * would have to agree about.
 *
 * These call the engine directly rather than through the UI. There is no screen
 * that sends a reminder, and the thing under test is which rows exist with
 * which keys — Appendix B is explicit that off-by-one-timezone bugs are
 * invisible until a real deadline is missed, so they are asserted exactly.
 */
import { expect, test } from '@playwright/test';

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { overdueMdKey, overdueMemberKey, reminderKey } from '../../src/lib/notifications/dedupe';
import { fromISTInput } from '../../src/lib/utils/time';

import { ACCOUNTS, e2ePrisma } from './fixtures/seed';
import { clearMailpit, getMailpitMessages } from './fixtures/mailpit';

test.describe.configure({ mode: 'serial' });

/*
 * The worker tsconfig, not the root one.
 *
 * The root config sets `jsx: preserve` for Next, which leaves `<Html>` in the
 * emitted code with no import of React to evaluate it — every mail then dies
 * with "React is not defined" and the sweeper records it as transient, so the
 * row sits at PENDING and the spec reads as a timing failure. The real worker
 * passes the same flag for the same reason.
 */
const TSX = ['exec', 'tsx', '--tsconfig', 'tsconfig.worker.json'];

/**
 * One sweep, in its own process.
 *
 * Not called in-process: Playwright instruments globals, and React Email's
 * renderer chokes on one of those objects — every send then fails as a
 * "transient" error and the row stays PENDING, which reads as a timing bug
 * rather than as the harness breaking the code under test.
 */
function sweep(action: 'dispatch' | 'escalate', at?: Date): Record<string, number> {
  const output = execFileSync(
    'pnpm',
    [...TSX, 'scripts/e2e-sweep.ts', action, ...(at ? [at.toISOString()] : [])],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const line = output.trim().split('\n').filter(Boolean).pop() ?? '{}';
  return JSON.parse(line) as Record<string, number>;
}

/** Schedules a subtask's notifications, also out of process. */
function schedule(subtaskId: string): void {
  execFileSync('pnpm', [...TSX, 'scripts/e2e-schedule.ts', subtaskId], { stdio: 'pipe' });
}

let counter = 0;

/** A published job with one subtask, built directly — the UI has its own spec. */
async function makeSubtask(deadlineIst: string) {
  const prisma = e2ePrisma();

  const md = await prisma.user.findUniqueOrThrow({ where: { email: ACCOUNTS.md } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: ACCOUNTS.production } });
  const department = await prisma.department.findFirstOrThrow({ where: { code: 'PRODUCTION' } });

  const job = await prisma.job.create({
    data: {
      // Unique per job, not per millisecond: these specs run twice over — once
      // per browser project — against one seeded database, and a timestamp
      // suffix collides the moment two of them land in the same tick.
      jobCode: `JGE-2026-9${String(++counter).padStart(3, '0')}-${randomUUID().slice(0, 8)}`,
      title: 'Spindle housing batch',
      overallDeadline: fromISTInput('2027-12-31T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
      publishedAt: new Date(),
    },
  });

  const subtask = await prisma.subtask.create({
    data: {
      jobId: job.id,
      departmentId: department.id,
      assigneeId: member.id,
      title: 'Machining and first-piece clearance',
      deadline: fromISTInput(deadlineIst),
      reminderLeadMinutes: 360,
      status: 'IN_PROGRESS',
    },
  });

  return { prisma, job, subtask, md, member };
}

test('the reminder is scheduled at the deadline minus the lead, with the right key', async () => {
  const { prisma, subtask, member } = await makeSubtask('2027-06-10T18:00');

  try {
    schedule(subtask.id);

    const rows = await prisma.notification.findMany({ where: { entityId: subtask.id } });

    const reminder = rows.find((row) => row.type === 'DEADLINE_REMINDER');
    expect(reminder, 'no reminder was scheduled').toBeTruthy();

    // Recipient: the assignee, nobody else.
    expect(reminder!.userId).toBe(member.id);

    // Timing: six hours before, to the millisecond.
    expect(reminder!.scheduledFor.toISOString()).toBe(
      new Date(subtask.deadline.getTime() - 360 * 60_000).toISOString(),
    );

    // Key: embeds the deadline, so an extension produces a different one and
    // the old can never fire (SDD 5.1).
    expect(reminder!.dedupeKey).toBe(reminderKey(subtask.id, subtask.deadline));
  } finally {
    await prisma.$disconnect();
  }
});

test('a reminder fires once however many times the sweeper runs', async () => {
  const { prisma, job, subtask, member } = await makeSubtask('2027-07-10T18:00');

  try {
    schedule(subtask.id);

    await prisma.notification.deleteMany({
      where: { entityId: subtask.id, type: 'SUBTASK_ASSIGNED' },
    });

    await clearMailpit();

    const at = new Date(subtask.deadline.getTime() - 360 * 60_000);

    for (let i = 0; i < 6; i++) sweep('dispatch', new Date(at.getTime() + i * 60_000));

    const rows = await prisma.notification.findMany({
      where: { entityId: subtask.id, type: 'DEADLINE_REMINDER' },
    });

    // One row, marked sent once. A sweeper that keeps running must not keep
    // mailing (SDD 5.2).
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('SENT');
    expect(rows[0].userId).toBe(member.id);

    // Assert against Mailpit: exactly one reminder message received for this job/subtask
    const mails = await getMailpitMessages();
    const reminderMails = mails.filter(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === ACCOUNTS.production.toLowerCase()) &&
        m.Subject.includes(job.jobCode),
    );
    expect(reminderMails).toHaveLength(1);
    expect(reminderMails[0].Subject).toContain('Due in 6 h');
  } finally {
    await prisma.$disconnect();
  }
});

test('an overdue subtask produces one member mail and one per commander', async () => {
  // Three hours past its deadline, which is the sweeper's own arithmetic.
  const deadline = new Date(Date.now() - 3 * 3_600_000);
  const { prisma, job, subtask, md, member } = await makeSubtask('2027-06-10T18:00');

  try {
    await prisma.subtask.update({ where: { id: subtask.id }, data: { deadline } });
    await prisma.notification.deleteMany({ where: { entityId: subtask.id } });

    await clearMailpit();

    const { escalated } = sweep('escalate');
    expect(escalated).toBeGreaterThanOrEqual(1);

    // Then deliver them. Escalation stores a placeholder subject and the real
    // one is rendered at send time, so the wording below is only observable
    // once the mail has actually gone out — which is also the only way to know
    // the template renders at all.
    sweep('dispatch');

    const rows = await prisma.notification.findMany({ where: { entityId: subtask.id } });

    const toMember = rows.filter((row) => row.type === 'OVERDUE_MEMBER');
    const toMd = rows.filter((row) => row.type === 'OVERDUE_MD');

    expect(toMember).toHaveLength(1);
    expect(toMember[0].userId).toBe(member.id);

    // One row per commander, so each can be read and retried independently.
    expect(toMd.length).toBeGreaterThanOrEqual(1);
    expect(toMd.map((row) => row.userId)).toContain(md.id);

    // Both actually delivered, and with the SDD 5.4 wording — the job code in
    // the subject is what makes the line useful in an inbox of forty.
    expect(toMember[0].status).toBe('SENT');
    expect(toMd[0].status).toBe('SENT');
    expect(toMember[0].subject).toBe(
      `[JTAS] Please complete: ${job.jobCode} \u2013 ${subtask.title}`,
    );
    expect(toMd[0].subject).toBe(
      `[JTAS] Overdue: ${job.jobCode} \u2013 Production \u2013 ${member.name}`,
    );

    // Keys carry the escalation number, so the second chase is a new row and a
    // retried first one is not.
    const row = await prisma.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(toMember[0].dedupeKey).toBe(overdueMemberKey(subtask.id, row.escalationCount));
    expect(toMd[0].dedupeKey).toBe(overdueMdKey(subtask.id, row.escalationCount, md.id));

    // Assert against Mailpit: both emails captured by SMTP
    const mails = await getMailpitMessages();
    const memberMail = mails.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === ACCOUNTS.production.toLowerCase()) &&
        m.Subject === toMember[0].subject,
    );
    const mdMail = mails.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === ACCOUNTS.md.toLowerCase()) &&
        m.Subject === toMd[0].subject,
    );
    expect(memberMail).toBeDefined();
    expect(mdMail).toBeDefined();
  } finally {
    await prisma.$disconnect();
  }
});

test('escalation stops at the configured maximum', async () => {
  const { prisma, subtask } = await makeSubtask('2027-06-10T18:00');

  try {
    await prisma.subtask.update({
      where: { id: subtask.id },
      data: { deadline: new Date(Date.now() - 3 * 3_600_000) },
    });
    await prisma.notification.deleteMany({ where: { entityId: subtask.id } });

    const max = 3;
    const start = Date.now();

    // Five passes, each well past the four-hour interval.
    for (let i = 0; i < 5; i++) {
      sweep('escalate', new Date(start + i * 5 * 3_600_000));
    }

    const row = await prisma.subtask.findUniqueOrThrow({ where: { id: subtask.id } });
    expect(row.escalationCount).toBe(max);

    const memberRows = await prisma.notification.findMany({
      where: { entityId: subtask.id, type: 'OVERDUE_MEMBER' },
    });

    // Unbounded mail trains people to filter it (improvement I-10).
    expect(memberRows).toHaveLength(max);
  } finally {
    await prisma.$disconnect();
  }
});

test('a subtask in PROBLEM is never chased', async () => {
  const { prisma, subtask } = await makeSubtask('2027-06-10T18:00');

  try {
    await prisma.subtask.update({
      where: { id: subtask.id },
      data: { deadline: new Date(Date.now() - 10 * 3_600_000), status: 'PROBLEM' },
    });
    await prisma.notification.deleteMany({ where: { entityId: subtask.id } });

    sweep('escalate');

    // Improvement I-05: the blocker is already on the MD's desk.
    const rows = await prisma.notification.findMany({ where: { entityId: subtask.id } });
    expect(rows).toHaveLength(0);
  } finally {
    await prisma.$disconnect();
  }
});
