import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import type { AppError } from '@/lib/errors';
import { createJob, publishJob } from '@/lib/services/jobs';
import {
  acknowledgeProblem,
  listProblems,
  raiseProblem,
  rejectProblem,
  resolveProblem,
} from '@/lib/services/problems';
import { bulkCreateSubtasks, changeStatus, loadSubtaskForWrite } from '@/lib/services/subtasks';
import { formatIST } from '@/lib/utils/time';

import {
  auditActionsFor,
  auditRowsFor,
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
const memberActor = () => ({ id: planningMember.id, role: 'MEMBER' as const });

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

/** A published job with one Planning subtask the member holds. */
async function publishedSubtask(deadline = '2027-06-10T18:00') {
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

  const [subtask] = await bulkCreateSubtasks(
    job.id,
    {
      subtasks: [
        {
          departmentId: planning.id,
          assigneeId: planningMember.id,
          title: 'Process plan and tooling list',
          deadline,
          reminderLeadMinutes: 360,
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

const BLOCKER = {
  description: 'Material short by 12 bars, the supplier has not confirmed a date',
  severity: 'BLOCKER' as const,
};

// ---------------------------------------------------------------------------
// Raising
// ---------------------------------------------------------------------------

describe('raiseProblem', () => {
  it('records the problem and moves the subtask to PROBLEM', async () => {
    const { subtask } = await publishedSubtask();

    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    expect(problem.severity).toBe('BLOCKER');
    expect(problem.status).toBe('OPEN');
    expect(problem.description).toContain('Material short');
    expect(problem.raisedBy?.id).toBe(planningMember.id);
    expect(problem.subtask.status).toBe('PROBLEM');

    expect(await auditActionsFor(problem.id)).toContain('PROBLEM_RAISED');
  });

  it('refuses a description shorter than the configured minimum', async () => {
    const { subtask } = await publishedSubtask();

    await expect(
      raiseProblem(subtask.id, { description: 'stuck', severity: 'HIGH' }, memberActor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await testDb.problem.count({ where: { subtaskId: subtask.id } })).toBe(0);
  });

  // ACCEPTANCE
  it('rejects a second problem on the same subtask with CONFLICT', async () => {
    const { subtask } = await publishedSubtask();
    await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const error = (await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx).catch(
      (e: AppError) => e,
    )) as AppError;

    expect(error.code).toBe('CONFLICT');
    expect(error.status).toBe(409);
    expect(error.details).toMatchObject({ reason: 'PROBLEM_ALREADY_OPEN' });
    // The conflict names the existing one so the UI can point at it.
    expect((error.details as { problemId: string }).problemId).toBeTruthy();

    expect(await testDb.problem.count({ where: { subtaskId: subtask.id } })).toBe(1);
  });

  it('refuses a second problem even while the first is only acknowledged', async () => {
    const { subtask } = await publishedSubtask();
    const first = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await acknowledgeProblem(first.id, mdActor, ctx);

    await expect(raiseProblem(subtask.id, BLOCKER, memberActor(), ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('allows a new problem once the previous one is closed', async () => {
    const { subtask } = await publishedSubtask();
    const first = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await resolveProblem(
      first.id,
      { action: 'RESUME', mdActionNote: 'Supplier confirmed for Tuesday' },
      mdActor,
      ctx,
    );

    await expect(raiseProblem(subtask.id, BLOCKER, memberActor(), ctx)).resolves.toMatchObject({
      status: 'OPEN',
    });
  });

  it('refuses when raised through the subtask endpoint as well', async () => {
    // The CONFLICT rule lives in the shared core, so both entry points get it.
    const { subtask } = await publishedSubtask();
    await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await expect(
      changeStatus(
        subtask.id,
        { action: 'PROBLEM', note: BLOCKER.description, severity: 'HIGH' },
        memberActor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — a blocker tops the inbox
// ---------------------------------------------------------------------------

describe('acceptance: a Blocker appears at the top of the inbox', () => {
  it('outranks older problems of lower severity', async () => {
    const { subtask: a } = await publishedSubtask('2027-06-11T18:00');
    const { subtask: b } = await publishedSubtask('2027-06-12T18:00');
    const { subtask: c } = await publishedSubtask('2027-06-13T18:00');

    // Two older, less serious problems first.
    const low = await raiseProblem(
      a.id,
      { description: 'Minor tooling wear, worth noting for later', severity: 'LOW' },
      memberActor(),
      ctx,
    );
    const high = await raiseProblem(
      b.id,
      { description: 'Drawing revision mismatch on the flange face', severity: 'HIGH' },
      memberActor(),
      ctx,
    );
    // Then the blocker, newest of the three.
    const blocker = await raiseProblem(c.id, BLOCKER, memberActor(), ctx);

    await testDb.problem.update({
      where: { id: low.id },
      data: { createdAt: new Date(Date.now() - 72 * 3_600_000) },
    });
    await testDb.problem.update({
      where: { id: high.id },
      data: { createdAt: new Date(Date.now() - 48 * 3_600_000) },
    });

    const inbox = await listProblems({ open: true });

    // Newest, but a blocker — so it leads.
    expect(inbox.data[0].id).toBe(blocker.id);
    expect(inbox.data.map((p) => p.severity)).toEqual(['BLOCKER', 'HIGH', 'LOW']);
    expect(inbox.counts).toMatchObject({ open: 3, blockers: 1 });
  });

  it('flags anything open longer than a day', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await testDb.problem.update({
      where: { id: problem.id },
      data: { createdAt: new Date(Date.now() - 30 * 3_600_000) },
    });

    const inbox = await listProblems({ open: true });
    expect(inbox.data[0].isStale).toBe(true);
    expect(inbox.data[0].ageHours).toBeGreaterThanOrEqual(30);
    expect(inbox.counts.stale).toBe(1);
  });

  it('carries every column the inbox shows', async () => {
    const { subtask } = await publishedSubtask();
    await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const [row] = (await listProblems({ open: true })).data;

    expect(row.subtask.job.jobCode).toMatch(/^JGE-/);
    expect(row.subtask.department.name).toBe('Planning');
    expect(row.subtask.assignee.name).toBeTruthy();
    expect(row.subtask.deadline).toBeInstanceOf(Date);
    expect(row.ageBucket).toBe('under2h');
  });

  it('filters by status, severity, department and age', async () => {
    const { subtask } = await publishedSubtask();
    await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await expect(listProblems({ severity: 'BLOCKER', open: true })).resolves.toMatchObject({
      data: [expect.objectContaining({ severity: 'BLOCKER' })],
    });
    expect((await listProblems({ severity: 'LOW', open: true })).data).toHaveLength(0);
    expect((await listProblems({ departmentId: purchase.id, open: true })).data).toHaveLength(0);
    expect((await listProblems({ ageBucket: 'over24h', open: true })).data).toHaveLength(0);
    expect((await listProblems({ ageBucket: 'under2h', open: true })).data).toHaveLength(1);
  });

  it('hides closed problems from the default view', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await resolveProblem(
      problem.id,
      { action: 'RESUME', mdActionNote: 'Supplier confirmed for Tuesday' },
      mdActor,
      ctx,
    );

    expect((await listProblems({ open: true })).data).toHaveLength(0);
    expect((await listProblems({ status: 'RESOLVED', open: false })).data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Acknowledge
// ---------------------------------------------------------------------------

describe('acknowledgeProblem', () => {
  it('timestamps it without stopping the ageing clock', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await testDb.problem.update({
      where: { id: problem.id },
      data: { createdAt: new Date(Date.now() - 30 * 3_600_000) },
    });

    const acknowledged = await acknowledgeProblem(problem.id, mdActor, ctx);

    expect(acknowledged.status).toBe('ACKNOWLEDGED');
    expect(acknowledged.acknowledgedAt).not.toBeNull();
    // Reading it is not deciding it.
    expect(acknowledged.isStale).toBe(true);

    expect(await auditActionsFor(problem.id)).toContain('PROBLEM_ACKNOWLEDGED');
  });

  it('refuses to acknowledge twice, or to acknowledge a closed problem', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await acknowledgeProblem(problem.id, mdActor, ctx);

    await expect(acknowledgeProblem(problem.id, mdActor, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await rejectProblem(problem.id, { note: 'Not actually a blocker' }, mdActor, ctx);
    await expect(acknowledgeProblem(problem.id, mdActor, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — resolve with EXTEND
// ---------------------------------------------------------------------------

describe('acceptance: MD resolves with EXTEND', () => {
  it('moves the deadline, returns the subtask to IN_PROGRESS, and records the chain', async () => {
    const { subtask } = await publishedSubtask('2027-06-10T18:00');
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const result = await resolveProblem(
      problem.id,
      {
        action: 'EXTEND',
        mdActionNote: 'Supplier confirmed 14 June; four extra days agreed with the customer',
        newDeadline: '2027-06-16T18:00',
      },
      mdActor,
      ctx,
    );

    expect(result.action).toBe('EXTEND');
    expect(result.problem.status).toBe('RESOLVED');
    expect(result.problem.resolvedAt).not.toBeNull();
    // The action is on the record, not just the words.
    expect(result.problem.mdActionNote).toContain('[EXTEND]');

    const updated = await loadSubtaskForWrite(subtask.id);
    expect(updated.status).toBe('IN_PROGRESS');
    expect(formatIST(updated.deadline!, "yyyy-MM-dd'T'HH:mm")).toBe('2027-06-16T18:00');

    // Extending through the inbox leaves the same trail as extending anywhere
    // else — there is no second, weaker path.
    const change = await testDb.deadlineChange.findFirstOrThrow({
      where: { subtaskId: subtask.id },
    });
    expect(change.reason).toContain('Problem resolved with more time');
    expect(change.changedById).toBe(md.id);
    expect(updated.escalationCount).toBe(0);

    // The whole chain is visible in the audit log.
    const subtaskActions = await auditActionsFor(subtask.id);
    expect(subtaskActions).toContain('SUBTASK_STATUS_CHANGED');
    expect(subtaskActions).toContain('SUBTASK_DEADLINE_CHANGED');

    const problemActions = await auditActionsFor(problem.id);
    expect(problemActions).toEqual(['PROBLEM_RAISED', 'PROBLEM_RESOLVED']);

    const resolved = (await auditRowsFor(problem.id)).find(
      (row) => row.action === 'PROBLEM_RESOLVED',
    )!;
    expect(resolved.after).toMatchObject({ resolutionAction: 'EXTEND', status: 'RESOLVED' });
    expect(resolved.actorId).toBe(md.id);
  });

  it('refuses EXTEND without a new deadline', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    // The schema catches it, so the service never sees a half-specified action.
    const { resolveProblemSchema } = await import('@/lib/validation/problem');
    const parsed = resolveProblemSchema.safeParse({
      action: 'EXTEND',
      mdActionNote: 'Giving more time',
    });
    expect(parsed.success).toBe(false);

    // And the problem is untouched.
    expect((await listProblems({ open: true })).data.map((p) => p.id)).toContain(problem.id);
  });

  it('warns when the new deadline passes the job deadline, and takes an override', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await expect(
      resolveProblem(
        problem.id,
        {
          action: 'EXTEND',
          mdActionNote: 'Pushing well past the job date',
          newDeadline: '2027-07-20T18:00',
        },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ details: { reason: 'DEADLINE_AFTER_JOB' } });

    // Still open — a failed deadline move must not read as a decision.
    expect((await listProblems({ open: true })).data[0].status).toBe('OPEN');

    await expect(
      resolveProblem(
        problem.id,
        {
          action: 'EXTEND',
          mdActionNote: 'Pushing well past the job date',
          newDeadline: '2027-07-20T18:00',
          deadlineOverrideReason: 'Customer has agreed to move the delivery',
        },
        mdActor,
        ctx,
      ),
    ).resolves.toMatchObject({ problem: { status: 'RESOLVED' } });
  });
});

// ---------------------------------------------------------------------------
// The other four resolutions
// ---------------------------------------------------------------------------

describe('resolveProblem — the other actions', () => {
  it('RESUME returns the subtask to IN_PROGRESS and changes nothing else', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    const before = await loadSubtaskForWrite(subtask.id);

    await resolveProblem(
      problem.id,
      { action: 'RESUME', mdActionNote: 'Supplier confirmed for Tuesday; carry on' },
      mdActor,
      ctx,
    );

    const after = await loadSubtaskForWrite(subtask.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.deadline!.toISOString()).toBe(before.deadline!.toISOString());
    expect(after.assigneeId).toBe(before.assigneeId);
  });

  it('REASSIGN moves the subtask and resumes it', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const cover = await createTestUser({
      email: 'cover@jaraaglobal.com',
      name: 'Cover Member',
      departmentId: planning.id,
    });

    await resolveProblem(
      problem.id,
      {
        action: 'REASSIGN',
        mdActionNote: 'Giving it to somebody who can chase the supplier',
        assigneeId: cover.id,
      },
      mdActor,
      ctx,
    );

    const after = await loadSubtaskForWrite(subtask.id);
    expect(after.assigneeId).toBe(cover.id);
    expect(after.status).toBe('IN_PROGRESS');
    expect(await auditActionsFor(subtask.id)).toContain('SUBTASK_REASSIGNED');
  });

  it('CANCEL_SUBTASK stops the work and closes the problem', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const result = await resolveProblem(
      problem.id,
      { action: 'CANCEL_SUBTASK', mdActionNote: 'Customer has withdrawn this line item' },
      mdActor,
      ctx,
    );

    expect((await loadSubtaskForWrite(subtask.id)).status).toBe('CANCELLED');
    expect(result.problem.status).toBe('RESOLVED');
    expect(result.problem.mdActionNote).toContain('[CANCEL_SUBTASK]');
  });

  it('ESCALATE_TO_DEPARTMENT creates the new subtask and makes the original wait', async () => {
    const { job, subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const result = await resolveProblem(
      problem.id,
      {
        action: 'ESCALATE_TO_DEPARTMENT',
        mdActionNote: 'Purchase must expedite the bar stock before Planning can finish',
        escalation: {
          departmentId: purchase.id,
          assigneeId: purchaseMember.id,
          title: 'Expedite EN8 bar stock',
          deadline: '2027-06-08T18:00',
          blockOriginal: true,
        },
      },
      mdActor,
      ctx,
    );

    expect(result.escalatedSubtaskId).toBeTruthy();

    const escalated = await loadSubtaskForWrite(result.escalatedSubtaskId!);
    expect(escalated.jobId).toBe(job.id);
    expect(escalated.departmentId).toBe(purchase.id);
    expect(escalated.assigneeId).toBe(purchaseMember.id);
    expect(escalated.description).toContain('Raised from a problem');

    // The original now depends on it…
    const original = await loadSubtaskForWrite(subtask.id);
    expect(original.dependsOnId).toBe(result.escalatedSubtaskId);
    expect(original.status).toBe('IN_PROGRESS');

    // …and cannot be completed until the escalated work is done, because the
    // state machine guards COMPLETE on an unfinished dependency.
    await expect(
      changeStatus(subtask.id, { action: 'COMPLETE' }, memberActor(), ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await changeStatus(
      result.escalatedSubtaskId!,
      { action: 'COMPLETE' },
      { id: purchaseMember.id, role: 'MEMBER' },
      ctx,
    );
    await expect(
      changeStatus(subtask.id, { action: 'COMPLETE' }, memberActor(), ctx),
    ).resolves.toMatchObject({ subtask: { status: 'COMPLETED' } });
  });

  it('ESCALATE without blockOriginal leaves the original free to finish', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    await resolveProblem(
      problem.id,
      {
        action: 'ESCALATE_TO_DEPARTMENT',
        mdActionNote: 'Purchase to chase in parallel; Planning can carry on',
        escalation: {
          departmentId: purchase.id,
          assigneeId: purchaseMember.id,
          title: 'Chase the supplier',
          deadline: '2027-06-08T18:00',
          blockOriginal: false,
        },
      },
      mdActor,
      ctx,
    );

    expect((await loadSubtaskForWrite(subtask.id)).dependsOnId).toBeNull();
    await expect(
      changeStatus(subtask.id, { action: 'COMPLETE' }, memberActor(), ctx),
    ).resolves.toBeDefined();
  });

  it('refuses to resolve a problem twice', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await resolveProblem(
      problem.id,
      { action: 'RESUME', mdActionNote: 'Supplier confirmed for Tuesday' },
      mdActor,
      ctx,
    );

    await expect(
      resolveProblem(
        problem.id,
        { action: 'RESUME', mdActionNote: 'Trying it again' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'PROBLEM_ALREADY_CLOSED' } });
  });

  it('tolerates a member who resolved their own blockage first', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    // The MD clears it from the subtask screen, then opens the inbox.
    await changeStatus(
      subtask.id,
      { action: 'RESOLVE_PROBLEM', note: 'Cleared from the task screen' },
      mdActor,
      ctx,
    );

    // The problem row is already resolved, so the inbox action is refused
    // rather than double-applying.
    await expect(
      resolveProblem(
        problem.id,
        { action: 'RESUME', mdActionNote: 'Also clearing from the inbox' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

describe('rejectProblem', () => {
  it('returns the work to the member with the reason on the record', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);

    const rejected = await rejectProblem(
      problem.id,
      { note: 'The bar stock is in the Store already — check bin 14' },
      mdActor,
      ctx,
    );

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.mdActionNote).toContain('bin 14');
    expect((await loadSubtaskForWrite(subtask.id)).status).toBe('IN_PROGRESS');

    expect(await auditActionsFor(problem.id)).toContain('PROBLEM_REJECTED');
  });

  it('refuses to reject a closed problem', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await rejectProblem(problem.id, { note: 'Not actually a blocker' }, mdActor, ctx);

    await expect(
      rejectProblem(problem.id, { note: 'Rejecting again' }, mdActor, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('lets the member raise a fresh problem after a rejection', async () => {
    const { subtask } = await publishedSubtask();
    const problem = await raiseProblem(subtask.id, BLOCKER, memberActor(), ctx);
    await rejectProblem(problem.id, { note: 'Check bin 14 before reporting' }, mdActor, ctx);

    await expect(
      raiseProblem(
        subtask.id,
        { description: 'Checked bin 14, it is empty — still short 12 bars', severity: 'BLOCKER' },
        memberActor(),
        ctx,
      ),
    ).resolves.toMatchObject({ status: 'OPEN' });
  });
});
