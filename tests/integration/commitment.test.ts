import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { can } from '@/lib/auth/policy';
import type { SessionUser } from '@/lib/auth/session';
import { COMMITMENT_REMINDER_LEAD_MS, COMMITMENT_WINDOW_MS } from '@/lib/domain/commitment';
import { dispatchDue, escalateMissedCommitments } from '@/lib/notifications/sweeper';
import { createJob, publishJob } from '@/lib/services/jobs';
import {
  bulkCreateSubtasks,
  changeDeadline,
  changeStatus,
  commitDeadline,
} from '@/lib/services/subtasks';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { mailsOfType, restoreMail, useCapturingMail } from './helpers/mail';

const ctx = { ipAddress: '203.0.113.7' };
const JOB_DEADLINE = '2027-06-30T18:00';

let md: SessionUser;
let mdActor: { id: string; role: 'MD' };
let planningMember: SessionUser;
let purchaseMember: SessionUser;
let planning: Awaited<ReturnType<typeof createTestDepartment>>;
let purchase: Awaited<ReturnType<typeof createTestDepartment>>;

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
  purchase = await createTestDepartment({ code: 'PURCHASE', name: 'Purchase', sequenceOrder: 2 });

  const mdRow = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  md = session(mdRow);
  mdActor = { id: mdRow.id, role: 'MD' };
  planningMember = session(
    await createTestUser({ email: 'planning@jaraaglobal.com', departmentId: planning.id }),
  );
  purchaseMember = session(
    await createTestUser({ email: 'purchase@jaraaglobal.com', departmentId: purchase.id }),
  );

  await testDb.setting.upsert({
    where: { key: 'suppress_reminders_outside_hours' },
    create: { key: 'suppress_reminders_outside_hours', value: false },
    update: { value: false },
  });
});

afterEach(() => {
  restoreMail();
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

async function makeJob() {
  return createJob(
    { title: 'Valve body batch', priority: 'NORMAL', overallDeadline: JOB_DEADLINE },
    mdActor,
    ctx,
  );
}

/** A two-step chain with no dates. The department commits when its turn arrives. */
async function datelessChain(jobId: string) {
  const created = await bulkCreateSubtasks(
    jobId,
    {
      subtasks: [
        {
          key: 'planning',
          departmentId: planning.id,
          assigneeId: planningMember.id,
          title: 'Process plan and tooling list',
          reminderLeadMinutes: 360,
          requiresApproval: false,
        },
        {
          key: 'purchase',
          departmentId: purchase.id,
          assigneeId: purchaseMember.id,
          title: 'Raise PO for raw material',
          reminderLeadMinutes: 360,
          requiresApproval: false,
          dependsOnKey: 'planning',
        },
      ],
    },
    mdActor,
    ctx,
  );

  return { planningSubtask: created[0]!, purchaseSubtask: created[1]! };
}

describe('sequential commitment', () => {
  it('opens the first department at publish and the next one on unblock', async () => {
    const job = await makeJob();
    const { planningSubtask, purchaseSubtask } = await datelessChain(job.id);
    const before = Date.now();

    await publishJob(job, mdActor, ctx);

    const planningRow = await testDb.subtask.findUniqueOrThrow({
      where: { id: planningSubtask.id },
    });
    const purchaseRow = await testDb.subtask.findUniqueOrThrow({
      where: { id: purchaseSubtask.id },
    });

    expect(planningRow.deadline).toBeNull();
    expect(planningRow.status).toBe('PENDING');
    expect(planningRow.commitmentDueAt).not.toBeNull();
    const window = planningRow.commitmentDueAt!.getTime() - before;
    expect(window).toBeGreaterThanOrEqual(COMMITMENT_WINDOW_MS - 5_000);
    expect(window).toBeLessThanOrEqual(COMMITMENT_WINDOW_MS + 5_000);

    expect(purchaseRow.status).toBe('BLOCKED');
    expect(purchaseRow.deadline).toBeNull();
    expect(purchaseRow.commitmentDueAt).toBeNull();

    const open = await testDb.notification.findMany({
      where: { entityId: planningSubtask.id, type: 'COMMITMENT_OPEN' },
    });
    expect(open).toHaveLength(1);
    expect(open[0]?.userId).toBe(planningMember.id);

    await changeStatus(
      planningSubtask.id,
      { action: 'COMPLETE', note: 'Plan issued.' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const purchaseAfter = await testDb.subtask.findUniqueOrThrow({
      where: { id: purchaseSubtask.id },
    });
    expect(purchaseAfter.status).toBe('PENDING');
    expect(purchaseAfter.commitmentDueAt).not.toBeNull();
    expect(purchaseAfter.deadline).toBeNull();

    const purchaseOpen = await testDb.notification.findMany({
      where: { entityId: purchaseSubtask.id, type: 'COMMITMENT_OPEN' },
    });
    expect(purchaseOpen).toHaveLength(1);
    const ready = await testDb.notification.findMany({
      where: { entityId: purchaseSubtask.id, type: 'READY_TO_START' },
    });
    expect(ready).toHaveLength(0);
  });

  it('fixes the date when the department commits, and the member cannot move it', async () => {
    const job = await makeJob();
    const { planningSubtask } = await datelessChain(job.id);
    await publishJob(job, mdActor, ctx);

    const committed = await commitDeadline(
      planningSubtask.id,
      { deadline: '2027-06-12T18:00' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    expect(committed.deadlineOrigin).toBe('DEPARTMENT');
    expect(committed.deadline).not.toBeNull();

    await expect(
      commitDeadline(
        planningSubtask.id,
        { deadline: '2027-06-20T18:00' },
        { id: planningMember.id, role: 'MEMBER' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(
      can(planningMember, 'subtask:changeDeadline', {
        id: planningSubtask.id,
        jobId: job.id,
        assigneeId: planningMember.id,
        departmentId: planning.id,
      }),
    ).toBe(false);

    const told = await testDb.notification.findMany({
      where: { entityId: planningSubtask.id, type: 'COMMITMENT_MADE' },
    });
    expect(told.map((row) => row.userId)).toEqual([purchaseMember.id]);
  });

  it('sends the reminder six hours before the window and the missed mail after it', async () => {
    const job = await makeJob();
    const { planningSubtask } = await datelessChain(job.id);
    await publishJob(job, mdActor, ctx);

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: planningSubtask.id } });
    const due = row.commitmentDueAt!;
    const remindAt = new Date(due.getTime() - COMMITMENT_REMINDER_LEAD_MS);

    const reminder = await testDb.notification.findFirstOrThrow({
      where: { entityId: planningSubtask.id, type: 'COMMITMENT_REMINDER' },
    });
    expect(reminder.scheduledFor.getTime()).toBe(remindAt.getTime());
    expect(reminder.status).toBe('PENDING');

    await dispatchDue(remindAt);
    expect(mailsOfType('COMMITMENT_REMINDER').map((mail) => mail.userId)).toContain(
      planningMember.id,
    );

    await escalateMissedCommitments(new Date(due.getTime() + 60_000));
    await dispatchDue(new Date(due.getTime() + 60_000));

    expect(mailsOfType('COMMITMENT_MISSED_MEMBER').map((mail) => mail.userId)).toContain(
      planningMember.id,
    );
    expect(mailsOfType('COMMITMENT_MISSED_MD').map((mail) => mail.userId)).toContain(md.id);
  });

  it('lets the MD set a date before anyone has committed, and move one after', async () => {
    const job = await makeJob();
    const { planningSubtask } = await datelessChain(job.id);
    await publishJob(job, mdActor, ctx);

    const set = await changeDeadline(
      planningSubtask.id,
      { newDeadline: '2027-06-11T18:00', reason: 'Customer moved the date up.' },
      mdActor,
      ctx,
    );
    expect(set.deadlineOrigin).toBe('MD');
    expect(set.deadline).not.toBeNull();

    const pendingChase = await testDb.notification.count({
      where: {
        entityId: planningSubtask.id,
        status: 'PENDING',
        type: { in: ['COMMITMENT_REMINDER', 'COMMITMENT_MISSED_MEMBER'] },
      },
    });
    expect(pendingChase).toBe(0);

    const moved = await changeDeadline(
      planningSubtask.id,
      { newDeadline: '2027-06-18T18:00', reason: 'Material will be a week late.' },
      mdActor,
      ctx,
    );
    expect(moved.deadlineOrigin).toBe('MD');
    expect(moved.deadline!.getTime()).toBeGreaterThan(set.deadline!.getTime());

    const told = await testDb.notification.findMany({
      where: { entityId: planningSubtask.id, type: 'PREDECESSOR_DATE_CHANGED' },
    });
    expect(told).toHaveLength(2);
    expect(told.every((row) => row.userId === purchaseMember.id)).toBe(true);
    expect(
      await testDb.notification.count({
        where: { entityId: planningSubtask.id, type: 'COMMITMENT_MADE' },
      }),
    ).toBe(0);
  });

  it('leaves a subtask that already has a date committed, with no window', async () => {
    const job = await makeJob();
    const [subtask] = await bulkCreateSubtasks(
      job.id,
      {
        subtasks: [
          {
            departmentId: planning.id,
            assigneeId: planningMember.id,
            title: 'Process plan and tooling list',
            deadline: '2027-06-10T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
          },
        ],
      },
      mdActor,
      ctx,
    );

    // A date that was already on the row — the migration marks those DEPARTMENT —
    // is left exactly as it was. Publish does not open a window over it.
    await testDb.subtask.update({
      where: { id: subtask!.id },
      data: { deadlineOrigin: 'DEPARTMENT' },
    });
    const before = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask!.id } });

    await publishJob(job, mdActor, ctx);

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: subtask!.id } });
    expect(row.deadline?.getTime()).toBe(before.deadline?.getTime());
    expect(row.deadlineOrigin).toBe('DEPARTMENT');
    expect(row.commitmentDueAt).toBeNull();

    const opened = await testDb.notification.count({
      where: { entityId: subtask!.id, type: 'COMMITMENT_OPEN' },
    });
    expect(opened).toBe(0);
  });
});
