import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import type { AppError } from '@/lib/errors';
import {
  decideExtensionRequest,
  listExtensionRequests,
  requestExtension,
} from '@/lib/services/extension-service';
import { createJob, publishJob } from '@/lib/services/jobs';
import { getMyTasks } from '@/lib/services/my-tasks-service';
import { bulkCreateSubtasks, changeStatus, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { formatIST, fromISTInput } from '@/lib/utils/time';

import {
  auditActionsFor,
  createTestDepartment,
  createTestUser,
  resetAuthTables,
  testDb,
} from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };

let md: SessionUser;
let mdActor: { id: string; role: 'MD' };
let planningMember: SessionUser;
let purchaseMember: SessionUser;
let planning: Awaited<ReturnType<typeof createTestDepartment>>;
let purchase: Awaited<ReturnType<typeof createTestDepartment>>;

const JOB_DEADLINE = '2027-06-30T18:00';

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
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

/** A published job with a two-step chain, deadlines supplied by the caller. */
async function publishedChain(deadlines: { planning: string; purchase: string }) {
  const job = await createJob(
    {
      title: 'Spindle housing batch',
      partNumber: 'SH-4410',
      priority: 'NORMAL',
      overallDeadline: JOB_DEADLINE,
    },
    mdActor,
    ctx,
  );

  const created = await bulkCreateSubtasks(
    job.id,
    {
      subtasks: [
        {
          key: 'planning',
          departmentId: planning.id,
          assigneeId: planningMember.id,
          title: 'Process plan and tooling list',
          deadline: deadlines.planning,
          reminderLeadMinutes: 360,
          requiresApproval: false,
        },
        {
          key: 'purchase',
          departmentId: purchase.id,
          assigneeId: purchaseMember.id,
          title: 'Raise PO for raw material',
          deadline: deadlines.purchase,
          reminderLeadMinutes: 360,
          requiresApproval: false,
          dependsOnKey: 'planning',
        },
      ],
    },
    mdActor,
    ctx,
  );

  await publishJob(job, mdActor, ctx);
  return { job, planningSubtask: created[0], purchaseSubtask: created[1] };
}

// ---------------------------------------------------------------------------
// getMyTasks
// ---------------------------------------------------------------------------

describe('getMyTasks', () => {
  it('returns only the caller’s own work', async () => {
    await publishedChain({ planning: '2027-06-10T18:00', purchase: '2027-06-20T18:00' });

    const mine = await getMyTasks(planningMember.id);
    const theirs = await getMyTasks(purchaseMember.id);

    const all = (result: Awaited<ReturnType<typeof getMyTasks>>) =>
      Object.values(result.buckets).flat();

    expect(all(mine).map((t) => t.title)).toEqual(['Process plan and tooling list']);
    expect(all(theirs).map((t) => t.title)).toEqual(['Raise PO for raw material']);
  });

  it('carries everything a card needs, in one call', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    const [task] = (await getMyTasks(planningMember.id)).buckets.later;

    expect(task).toMatchObject({
      id: planningSubtask.id,
      jobCode: expect.stringMatching(/^JGE-/),
      jobTitle: 'Spindle housing batch',
      partNumber: 'SH-4410',
      title: 'Process plan and tooling list',
      status: 'PENDING',
      hasOpenProblem: false,
    });
    expect(task.department.name).toBe('Planning');
    expect(task.hoursRemaining).toBeGreaterThan(0);
  });

  it('explains a blocked task with its predecessor’s department and state', async () => {
    await publishedChain({ planning: '2027-06-10T18:00', purchase: '2027-06-20T18:00' });

    const [blocked] = (await getMyTasks(purchaseMember.id)).buckets.blocked;

    // The member has to be able to see why, without opening another screen.
    expect(blocked.dependency).toMatchObject({
      title: 'Process plan and tooling list',
      departmentName: 'Planning',
      status: 'PENDING',
    });
  });

  it('buckets by IST day and reports hoursRemaining as negative when overdue', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    await testDb.subtask.update({
      where: { id: planningSubtask.id },
      data: { deadline: new Date('2020-01-01T00:00:00Z') },
    });

    const result = await getMyTasks(planningMember.id);
    expect(result.buckets.overdue).toHaveLength(1);
    expect(result.buckets.overdue[0].hoursRemaining).toBeLessThan(0);
    expect(result.summary.overdue).toBe(1);
  });

  it('flags an open problem and counts it in the summary', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    await changeStatus(
      planningSubtask.id,
      { action: 'PROBLEM', note: 'Drawing mismatch on the flange face', severity: 'HIGH' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const result = await getMyTasks(planningMember.id);
    const [task] = result.buckets.later;

    expect(task.hasOpenProblem).toBe(true);
    expect(task.status).toBe('PROBLEM');
    expect(result.summary.openProblems).toBe(1);
  });

  it('stops flagging once the problem is resolved', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    await changeStatus(
      planningSubtask.id,
      { action: 'PROBLEM', note: 'Drawing mismatch on the flange face', severity: 'HIGH' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );
    await changeStatus(
      planningSubtask.id,
      { action: 'RESOLVE_PROBLEM', note: 'Drawing reissued' },
      mdActor,
      ctx,
    );

    expect((await getMyTasks(planningMember.id)).summary.openProblems).toBe(0);
  });

  it('moves completed work into recentlyCompleted', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    await changeStatus(
      planningSubtask.id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const result = await getMyTasks(planningMember.id);
    expect(result.buckets.recentlyCompleted).toHaveLength(1);
    expect(result.buckets.later).toHaveLength(0);
  });

  it('hides work on a draft, cancelled or held job', async () => {
    // A draft has not been announced, and a cancelled or paused job is not the
    // member's to act on.
    const job = await createJob(
      { title: 'Never published', priority: 'NORMAL', overallDeadline: JOB_DEADLINE },
      mdActor,
      ctx,
    );
    await bulkCreateSubtasks(
      job.id,
      {
        subtasks: [
          {
            departmentId: planning.id,
            assigneeId: planningMember.id,
            title: 'Invisible',
            deadline: '2027-06-10T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
          },
        ],
      },
      mdActor,
      ctx,
    );

    const result = await getMyTasks(planningMember.id);
    expect(Object.values(result.buckets).flat()).toHaveLength(0);
  });

  it('returns every bucket even when empty, so the screen needs no guards', async () => {
    const result = await getMyTasks(planningMember.id);
    expect(Object.keys(result.buckets).sort()).toEqual([
      'awaitingApproval',
      'blocked',
      'dueThisWeek',
      'dueToday',
      'later',
      'overdue',
      'recentlyCompleted',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — a blocked task cannot be started
// ---------------------------------------------------------------------------

describe('acceptance: a BLOCKED task cannot be started', () => {
  it('is refused by the service, not only hidden in the UI', async () => {
    const { purchaseSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    expect((await loadSubtaskForWrite(purchaseSubtask.id)).status).toBe('BLOCKED');

    await expect(
      changeStatus(
        purchaseSubtask.id,
        { action: 'START' },
        { id: purchaseMember.id, role: 'MEMBER' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — a 15-character problem description is rejected by the API
// ---------------------------------------------------------------------------

describe('acceptance: a short problem description is rejected server-side', () => {
  it('refuses 15 characters and accepts 20', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });
    const member = { id: planningMember.id, role: 'MEMBER' as const };

    const fifteen = 'x'.repeat(15);
    expect(fifteen).toHaveLength(15);

    await expect(
      changeStatus(
        planningSubtask.id,
        { action: 'PROBLEM', note: fifteen, severity: 'HIGH' },
        member,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Nothing was written.
    expect(await testDb.problem.count({ where: { subtaskId: planningSubtask.id } })).toBe(0);

    await expect(
      changeStatus(
        planningSubtask.id,
        { action: 'PROBLEM', note: 'x'.repeat(20), severity: 'HIGH' },
        member,
        ctx,
      ),
    ).resolves.toMatchObject({ subtask: { status: 'PROBLEM' } });
  });

  it('counts the trimmed length, so whitespace cannot pad it out', async () => {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });

    await expect(
      changeStatus(
        planningSubtask.id,
        { action: 'PROBLEM', note: `  ${'x'.repeat(15)}${' '.repeat(20)}  `, severity: 'HIGH' },
        { id: planningMember.id, role: 'MEMBER' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// Extension requests — FR-33, improvement I-11
// ---------------------------------------------------------------------------

describe('extension requests', () => {
  async function subject() {
    const { planningSubtask } = await publishedChain({
      planning: '2027-06-10T18:00',
      purchase: '2027-06-20T18:00',
    });
    return planningSubtask;
  }

  const memberActor = () => ({ id: planningMember.id, role: 'MEMBER' as const });

  it('records a request and leaves the deadline alone', async () => {
    const subtask = await subject();

    const request = await requestExtension(
      subtask.id,
      {
        requestedDeadline: '2027-06-14T18:00',
        reason: 'The tooling supplier has slipped by four days',
      },
      memberActor(),
      ctx,
    );

    expect(request.status).toBe('PENDING');
    // Asking is not getting.
    expect((await loadSubtaskForWrite(subtask.id)).deadline.toISOString()).toBe(
      fromISTInput('2027-06-10T18:00').toISOString(),
    );
    expect(await auditActionsFor(subtask.id)).toContain('EXTENSION_REQUESTED');
  });

  it('refuses a requested time that is not later than the current deadline', async () => {
    const subtask = await subject();

    await expect(
      requestExtension(
        subtask.id,
        {
          requestedDeadline: '2027-06-09T18:00',
          reason: 'This is earlier, which makes no sense at all',
        },
        memberActor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('allows only one pending request at a time', async () => {
    const subtask = await subject();
    const input = {
      requestedDeadline: '2027-06-14T18:00',
      reason: 'The tooling supplier has slipped by four days',
    };

    await requestExtension(subtask.id, input, memberActor(), ctx);

    // A queue of them would leave the MD deciding which date is wanted.
    const error = (await requestExtension(subtask.id, input, memberActor(), ctx).catch(
      (e: AppError) => e,
    )) as AppError;
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toMatchObject({ reason: 'REQUEST_ALREADY_PENDING' });
  });

  it('approving moves the deadline through the normal change path', async () => {
    const subtask = await subject();
    const request = await requestExtension(
      subtask.id,
      {
        requestedDeadline: '2027-06-14T18:00',
        reason: 'The tooling supplier has slipped by four days',
      },
      memberActor(),
      ctx,
    );

    const decided = await decideExtensionRequest(request.id, { decision: 'APPROVE' }, mdActor, ctx);

    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedById).toBe(md.id);

    const updated = await loadSubtaskForWrite(subtask.id);
    expect(formatIST(updated.deadline, "yyyy-MM-dd'T'HH:mm")).toBe('2027-06-14T18:00');

    // The same trail as any other deadline change — not a second, weaker path.
    const change = await testDb.deadlineChange.findFirstOrThrow({
      where: { subtaskId: subtask.id },
    });
    expect(change.reason).toContain('Extension approved:');
    expect(change.reason).toContain('tooling supplier');
    expect(await auditActionsFor(subtask.id)).toContain('SUBTASK_DEADLINE_CHANGED');
    expect(await auditActionsFor(subtask.id)).toContain('EXTENSION_APPROVED');
  });

  it('rejecting records the decision and leaves the deadline alone', async () => {
    const subtask = await subject();
    const request = await requestExtension(
      subtask.id,
      {
        requestedDeadline: '2027-06-14T18:00',
        reason: 'The tooling supplier has slipped by four days',
      },
      memberActor(),
      ctx,
    );

    const decided = await decideExtensionRequest(
      request.id,
      { decision: 'REJECT', note: 'Customer will not move the delivery date' },
      mdActor,
      ctx,
    );

    expect(decided.status).toBe('REJECTED');
    expect((await loadSubtaskForWrite(subtask.id)).deadline.toISOString()).toBe(
      fromISTInput('2027-06-10T18:00').toISOString(),
    );
    expect(await auditActionsFor(subtask.id)).toContain('EXTENSION_REJECTED');
  });

  it('refuses to decide the same request twice', async () => {
    const subtask = await subject();
    const request = await requestExtension(
      subtask.id,
      {
        requestedDeadline: '2027-06-14T18:00',
        reason: 'The tooling supplier has slipped by four days',
      },
      memberActor(),
      ctx,
    );

    await decideExtensionRequest(request.id, { decision: 'APPROVE' }, mdActor, ctx);

    await expect(
      decideExtensionRequest(request.id, { decision: 'REJECT' }, mdActor, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'ALREADY_DECIDED' } });
  });

  it('refuses a request on a finished subtask', async () => {
    const subtask = await subject();
    await changeStatus(subtask.id, { action: 'COMPLETE' }, memberActor(), ctx);

    await expect(
      requestExtension(
        subtask.id,
        {
          requestedDeadline: '2027-06-14T18:00',
          reason: 'This subtask is already finished though',
        },
        memberActor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lists the history newest first', async () => {
    const subtask = await subject();
    const first = await requestExtension(
      subtask.id,
      { requestedDeadline: '2027-06-12T18:00', reason: 'First attempt at asking for more time' },
      memberActor(),
      ctx,
    );
    await decideExtensionRequest(first.id, { decision: 'REJECT' }, mdActor, ctx);
    await requestExtension(
      subtask.id,
      { requestedDeadline: '2027-06-14T18:00', reason: 'Second attempt after the rejection' },
      memberActor(),
      ctx,
    );

    const history = await listExtensionRequests(subtask.id);
    expect(history).toHaveLength(2);
    expect(history[0].reason).toContain('Second attempt');
    expect(history[1].status).toBe('REJECTED');
  });
});
