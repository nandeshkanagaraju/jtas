import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import type { AppError } from '@/lib/errors';
import { createJob, loadJobForWrite, publishJob } from '@/lib/services/jobs';
import {
  bulkCreateSubtasks,
  changeDeadline,
  changeStatus,
  createSubtask,
  listJobSubtasks,
  reassignSubtask,
  updateSubtaskMeta,
} from '@/lib/services/subtasks';
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

async function makeJob() {
  return createJob(
    { title: 'Spindle housing batch', priority: 'NORMAL', overallDeadline: JOB_DEADLINE },
    mdActor,
    ctx,
  );
}

/** The seeded two-step chain: Planning, then Purchase waiting on it. */
async function makeChain(jobId: string) {
  const created = await bulkCreateSubtasks(
    jobId,
    {
      subtasks: [
        {
          key: 'planning',
          departmentId: planning.id,
          assigneeId: planningMember.id,
          title: 'Process plan and tooling list',
          deadline: '2027-06-10T18:00',
          reminderLeadMinutes: 360,
          requiresApproval: false,
        },
        {
          key: 'purchase',
          departmentId: purchase.id,
          assigneeId: purchaseMember.id,
          title: 'Raise PO for raw material',
          deadline: '2027-06-20T18:00',
          reminderLeadMinutes: 360,
          requiresApproval: false,
          dependsOnKey: 'planning',
        },
      ],
    },
    mdActor,
    ctx,
  );

  return { planningSubtask: created[0], purchaseSubtask: created[1] };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createSubtask', () => {
  it('creates a PENDING subtask and audits it', async () => {
    const job = await makeJob();

    const subtask = await createSubtask(
      job.id,
      {
        departmentId: planning.id,
        assigneeId: planningMember.id,
        title: 'Process plan and tooling list',
        deadline: '2027-06-10T18:00',
        reminderLeadMinutes: 360,
        requiresApproval: false,
      },
      mdActor,
      ctx,
    );

    expect(subtask.status).toBe('PENDING');
    // 18:00 IST is 12:30 UTC — built through fromISTInput, never new Date().
    expect(subtask.deadline.toISOString()).toBe('2027-06-10T12:30:00.000Z');
    expect(formatIST(subtask.deadline, 'HH:mm')).toBe('18:00');

    expect(await auditActionsFor(subtask.id)).toContain('SUBTASK_CREATED');
  });

  it('refuses a deadline in the past', async () => {
    const job = await makeJob();

    await expect(
      createSubtask(
        job.id,
        {
          departmentId: planning.id,
          assigneeId: planningMember.id,
          title: 'Too late',
          deadline: '2020-01-01T09:00',
          reminderLeadMinutes: 360,
          requiresApproval: false,
        },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('warns rather than blocks when the deadline is after the job deadline (FR-23)', async () => {
    const job = await makeJob();
    const draft = {
      departmentId: planning.id,
      assigneeId: planningMember.id,
      title: 'Runs long',
      // After the job's 30 June deadline.
      deadline: '2027-07-15T18:00',
      reminderLeadMinutes: 360,
      requiresApproval: false,
    };

    const refused = (await createSubtask(job.id, draft, mdActor, ctx).catch(
      (e: AppError) => e,
    )) as AppError;
    expect(refused.code).toBe('VALIDATION_ERROR');
    expect(refused.details).toMatchObject({
      reason: 'DEADLINE_AFTER_JOB',
      requiresOverride: 'deadlineOverrideReason',
    });

    // With a reason it goes through, and the reason is on the record.
    const subtask = await createSubtask(
      job.id,
      { ...draft, deadlineOverrideReason: 'Customer agreed a later delivery' },
      mdActor,
      ctx,
    );
    expect(subtask.id).toBeTruthy();

    const override = (await auditRowsFor(subtask.id)).find(
      (row) => row.action === 'SUBTASK_UPDATED',
    );
    expect(override?.after).toMatchObject({
      overrides: { deadlineAfterJobDeadline: 'Customer agreed a later delivery' },
    });
  });

  it('warns rather than blocks when the assignee is in another department', async () => {
    const job = await makeJob();
    const draft = {
      departmentId: planning.id,
      // A Purchase member on a Planning subtask.
      assigneeId: purchaseMember.id,
      title: 'Covering for Planning',
      deadline: '2027-06-10T18:00',
      reminderLeadMinutes: 360,
      requiresApproval: false,
    };

    const refused = (await createSubtask(job.id, draft, mdActor, ctx).catch(
      (e: AppError) => e,
    )) as AppError;
    expect(refused.details).toMatchObject({ reason: 'ASSIGNEE_OUTSIDE_DEPARTMENT' });

    await expect(
      createSubtask(
        job.id,
        { ...draft, assigneeOverrideReason: 'Planning is on leave this week' },
        mdActor,
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a deactivated or administrator assignee outright', async () => {
    const job = await makeJob();
    const inactive = await createTestUser({
      email: 'gone@jaraaglobal.com',
      departmentId: planning.id,
      isActive: false,
    });
    const admin = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN' });

    for (const assigneeId of [inactive.id, admin.id]) {
      await expect(
        createSubtask(
          job.id,
          {
            departmentId: planning.id,
            assigneeId,
            title: 'Nobody can do this',
            deadline: '2027-06-10T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
            // Even with an override, these two are hard refusals.
            assigneeOverrideReason: 'Trying it on',
          },
          mdActor,
          ctx,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — the template chain, and publish setting PENDING/BLOCKED
// ---------------------------------------------------------------------------

describe('acceptance: publishing sets PENDING and BLOCKED correctly', () => {
  it('creates the whole chain in one call, resolving in-batch dependencies', async () => {
    const job = await makeJob();
    const { planningSubtask, purchaseSubtask } = await makeChain(job.id);

    expect(planningSubtask.dependsOnId).toBeNull();
    // The `dependsOnKey` reference became a real foreign key.
    expect(purchaseSubtask.dependsOnId).toBe(planningSubtask.id);
  });

  it('sets the first step PENDING and its dependent BLOCKED at publish', async () => {
    const job = await makeJob();
    const { planningSubtask, purchaseSubtask } = await makeChain(job.id);

    await publishJob(job, mdActor, ctx);

    const subtasks = await listJobSubtasks(md, job.id);
    const byId = new Map(subtasks.map((s) => [s.id, s]));

    expect(byId.get(planningSubtask.id)!.status).toBe('PENDING');
    expect(byId.get(purchaseSubtask.id)!.status).toBe('BLOCKED');

    expect(await auditActionsFor(purchaseSubtask.id)).toContain('SUBTASK_BLOCKED');
  });

  it('leaves an independent subtask PENDING, however late its deadline', async () => {
    const job = await makeJob();
    await createSubtask(
      job.id,
      {
        departmentId: planning.id,
        assigneeId: planningMember.id,
        title: 'Runs in parallel',
        deadline: '2027-06-25T18:00',
        reminderLeadMinutes: 360,
        requiresApproval: false,
      },
      mdActor,
      ctx,
    );

    await publishJob(job, mdActor, ctx);

    const [subtask] = await listJobSubtasks(md, job.id);
    expect(subtask.status).toBe('PENDING');
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — completing Planning unblocks Purchase automatically
// ---------------------------------------------------------------------------

describe('acceptance: completing a subtask unblocks its dependent', () => {
  it('flips Purchase from BLOCKED to PENDING when Planning completes', async () => {
    const job = await makeJob();
    const { planningSubtask, purchaseSubtask } = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);

    const result = await changeStatus(
      planningSubtask.id,
      { action: 'COMPLETE', note: 'Routing issued' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    expect(result.subtask.status).toBe('COMPLETED');
    expect(result.subtask.completedAt).not.toBeNull();
    // The consequence is reported, not left invisible.
    expect(result.unblocked).toEqual([purchaseSubtask.id]);

    const purchaseRow = await testDb.subtask.findUniqueOrThrow({
      where: { id: purchaseSubtask.id },
    });
    expect(purchaseRow.status).toBe('PENDING');

    expect(await auditActionsFor(purchaseSubtask.id)).toContain('SUBTASK_UNBLOCKED');
  });

  it('refuses to start or complete a blocked subtask (I-02)', async () => {
    const job = await makeJob();
    const { purchaseSubtask } = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);

    for (const action of ['START', 'COMPLETE'] as const) {
      await expect(
        changeStatus(
          purchaseSubtask.id,
          { action },
          { id: purchaseMember.id, role: 'MEMBER' },
          ctx,
        ),
        action,
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    }
  });

  it('only unblocks the immediate dependent, not the whole chain', async () => {
    const job = await makeJob();
    const created = await bulkCreateSubtasks(
      job.id,
      {
        subtasks: [
          {
            key: 'a',
            departmentId: planning.id,
            assigneeId: planningMember.id,
            title: 'Planning',
            deadline: '2027-06-05T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
          },
          {
            key: 'b',
            departmentId: purchase.id,
            assigneeId: purchaseMember.id,
            title: 'Purchase',
            deadline: '2027-06-10T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
            dependsOnKey: 'a',
          },
          {
            key: 'c',
            departmentId: purchase.id,
            assigneeId: purchaseMember.id,
            title: 'Store',
            deadline: '2027-06-15T18:00',
            reminderLeadMinutes: 360,
            requiresApproval: false,
            dependsOnKey: 'b',
          },
        ],
      },
      mdActor,
      ctx,
    );
    await publishJob(job, mdActor, ctx);

    const result = await changeStatus(
      created[0].id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    expect(result.unblocked).toEqual([created[1].id]);
    // Store still waits for Purchase.
    const store = await testDb.subtask.findUniqueOrThrow({ where: { id: created[2].id } });
    expect(store.status).toBe('BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — cyclic dependencies are rejected
// ---------------------------------------------------------------------------

describe('acceptance: a cyclic dependency is rejected', () => {
  it('refuses to point a subtask at its own dependent', async () => {
    const job = await makeJob();
    const { planningSubtask, purchaseSubtask } = await makeChain(job.id);

    // Purchase already depends on Planning; making Planning wait for Purchase
    // would leave both blocked forever.
    const error = (await updateSubtaskMeta(
      planningSubtask.id,
      { dependsOnId: purchaseSubtask.id },
      mdActor,
      ctx,
    ).catch((e: AppError) => e)) as AppError;

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toMatchObject({ reason: 'DEPENDENCY_CYCLE' });
  });

  it('refuses a subtask that depends on itself', async () => {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);

    await expect(
      updateSubtaskMeta(planningSubtask.id, { dependsOnId: planningSubtask.id }, mdActor, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a cycle formed inside a single batch', async () => {
    const job = await makeJob();

    await expect(
      bulkCreateSubtasks(
        job.id,
        {
          subtasks: [
            {
              key: 'a',
              departmentId: planning.id,
              assigneeId: planningMember.id,
              title: 'A',
              deadline: '2027-06-05T18:00',
              reminderLeadMinutes: 360,
              requiresApproval: false,
              dependsOnKey: 'b',
            },
            {
              key: 'b',
              departmentId: purchase.id,
              assigneeId: purchaseMember.id,
              title: 'B',
              deadline: '2027-06-10T18:00',
              reminderLeadMinutes: 360,
              requiresApproval: false,
              dependsOnKey: 'a',
            },
          ],
        },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { reason: 'DEPENDENCY_CYCLE' } });

    // Nothing was written — the batch is validated before any insert.
    expect(await testDb.subtask.count({ where: { jobId: job.id } })).toBe(0);
  });

  it('refuses a dependency on a subtask of another job', async () => {
    const jobA = await makeJob();
    const jobB = await makeJob();
    const { planningSubtask } = await makeChain(jobA.id);
    const { purchaseSubtask: otherJobSubtask } = await makeChain(jobB.id);

    await expect(
      updateSubtaskMeta(planningSubtask.id, { dependsOnId: otherJobSubtask.id }, mdActor, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'DEPENDENCY_OTHER_JOB' },
    });
  });
});

// ---------------------------------------------------------------------------
// Status changes and the cascade (SDD 4.4)
// ---------------------------------------------------------------------------

describe('changeStatus', () => {
  async function publishedChain() {
    const job = await makeJob();
    const chain = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);
    return { job, ...chain };
  }

  it('records from and to on every status change', async () => {
    const { planningSubtask } = await publishedChain();

    await changeStatus(
      planningSubtask.id,
      { action: 'START' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const entry = (await auditRowsFor(planningSubtask.id)).find(
      (row) => row.action === 'SUBTASK_STATUS_CHANGED',
    )!;
    expect(entry.before).toMatchObject({ status: 'PENDING' });
    expect(entry.after).toMatchObject({ status: 'IN_PROGRESS', action: 'START' });
  });

  it('stamps startedAt once and keeps it across later transitions', async () => {
    const { planningSubtask } = await publishedChain();
    const member = { id: planningMember.id, role: 'MEMBER' as const };

    const started = await changeStatus(planningSubtask.id, { action: 'START' }, member, ctx);
    const firstStamp = started.subtask.startedAt!.toISOString();

    await changeStatus(
      planningSubtask.id,
      { action: 'PROBLEM', note: 'Drawing mismatch on the flange face', severity: 'HIGH' },
      member,
      ctx,
    );
    await changeStatus(
      planningSubtask.id,
      { action: 'RESOLVE_PROBLEM', note: 'Drawing reissued' },
      mdActor,
      ctx,
    );

    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: planningSubtask.id } });
    expect(row.startedAt!.toISOString()).toBe(firstStamp);
  });

  it('creates a Problem row with the description and severity (FR-32)', async () => {
    const { planningSubtask } = await publishedChain();

    await changeStatus(
      planningSubtask.id,
      {
        action: 'PROBLEM',
        note: 'Material short by 12 bars, supplier delayed',
        severity: 'BLOCKER',
      },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const problem = await testDb.problem.findFirstOrThrow({
      where: { subtaskId: planningSubtask.id },
    });
    expect(problem.severity).toBe('BLOCKER');
    expect(problem.status).toBe('OPEN');
    expect(problem.raisedById).toBe(planningMember.id);
    expect(problem.description).toContain('Material short');
  });

  it('refuses a problem description shorter than the minimum', async () => {
    const { planningSubtask } = await publishedChain();

    await expect(
      changeStatus(
        planningSubtask.id,
        { action: 'PROBLEM', note: 'stuck', severity: 'HIGH' },
        { id: planningMember.id, role: 'MEMBER' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(await testDb.problem.count({ where: { subtaskId: planningSubtask.id } })).toBe(0);
  });

  it('closes the open problem when the MD resolves through the subtask (FR-43)', async () => {
    const { planningSubtask } = await publishedChain();

    await changeStatus(
      planningSubtask.id,
      { action: 'PROBLEM', note: 'Drawing mismatch on the flange face', severity: 'HIGH' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const resolved = await changeStatus(
      planningSubtask.id,
      { action: 'RESOLVE_PROBLEM', note: 'Reissued drawing rev C' },
      mdActor,
      ctx,
    );

    expect(resolved.subtask.status).toBe('IN_PROGRESS');

    const problem = await testDb.problem.findFirstOrThrow({
      where: { subtaskId: planningSubtask.id },
    });
    // The MD inbox must not keep showing something already dealt with.
    expect(problem.status).toBe('RESOLVED');
    expect(problem.resolvedById).toBe(md.id);
    expect(problem.mdActionNote).toBe('Reissued drawing rev C');
  });

  it('sends a flagged subtask to AWAITING_APPROVAL instead of COMPLETED (FR-25)', async () => {
    const job = await makeJob();
    const subtask = await createSubtask(
      job.id,
      {
        departmentId: planning.id,
        assigneeId: planningMember.id,
        title: 'Quality clearance',
        deadline: '2027-06-10T18:00',
        reminderLeadMinutes: 360,
        requiresApproval: true,
      },
      mdActor,
      ctx,
    );
    await publishJob(job, mdActor, ctx);

    const completed = await changeStatus(
      subtask.id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );
    expect(completed.subtask.status).toBe('AWAITING_APPROVAL');

    // A member cannot approve their own work.
    await expect(
      changeStatus(
        subtask.id,
        { action: 'APPROVE' },
        { id: planningMember.id, role: 'MEMBER' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const approved = await changeStatus(subtask.id, { action: 'APPROVE' }, mdActor, ctx);
    expect(approved.subtask.status).toBe('COMPLETED');
    expect(approved.subtask.completedAt).not.toBeNull();
  });

  it('clears completedAt when the MD rejects, so it does not read as finished', async () => {
    const job = await makeJob();
    const subtask = await createSubtask(
      job.id,
      {
        departmentId: planning.id,
        assigneeId: planningMember.id,
        title: 'Quality clearance',
        deadline: '2027-06-10T18:00',
        reminderLeadMinutes: 360,
        requiresApproval: true,
      },
      mdActor,
      ctx,
    );
    await publishJob(job, mdActor, ctx);
    await changeStatus(
      subtask.id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    const rejected = await changeStatus(
      subtask.id,
      { action: 'REJECT', note: 'Inspection report is missing the flatness figure' },
      mdActor,
      ctx,
    );

    expect(rejected.subtask.status).toBe('IN_PROGRESS');
    expect(rejected.subtask.completedAt).toBeNull();
  });

  it('drives the job status through the cascade', async () => {
    const { job, planningSubtask, purchaseSubtask } = await publishedChain();

    await changeStatus(
      planningSubtask.id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );
    await changeStatus(
      purchaseSubtask.id,
      { action: 'COMPLETE' },
      { id: purchaseMember.id, role: 'MEMBER' },
      ctx,
    );

    const finished = await loadJobForWrite(job.id);
    expect(finished.status).toBe('COMPLETED');
    expect(finished.completedAt).not.toBeNull();
  });

  it('puts the job AT_RISK when a subtask reports a problem', async () => {
    const { job, planningSubtask } = await publishedChain();

    await changeStatus(
      planningSubtask.id,
      { action: 'PROBLEM', note: 'Material short by 12 bars, supplier delayed', severity: 'HIGH' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    expect((await loadJobForWrite(job.id)).status).toBe('AT_RISK');
  });
});

// ---------------------------------------------------------------------------
// Deadline changes (SDD 4.5)
// ---------------------------------------------------------------------------

describe('changeDeadline', () => {
  async function publishedSubtask() {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);
    return planningSubtask;
  }

  it('writes a DeadlineChange row and resets the escalation clock', async () => {
    const subtask = await publishedSubtask();

    // Simulate two overdue escalations already fired.
    await testDb.subtask.update({
      where: { id: subtask.id },
      data: { escalationCount: 2, lastEscalatedAt: new Date() },
    });

    const updated = await changeDeadline(
      subtask.id,
      { newDeadline: '2027-06-18T18:00', reason: 'Customer moved the collection date' },
      mdActor,
      ctx,
    );

    expect(updated.deadline.toISOString()).toBe('2027-06-18T12:30:00.000Z');
    // A fresh deadline starts a fresh clock, or it would escalate again at once.
    expect(updated.escalationCount).toBe(0);
    expect(updated.lastEscalatedAt).toBeNull();

    const change = await testDb.deadlineChange.findFirstOrThrow({
      where: { subtaskId: subtask.id },
    });
    expect(change.reason).toBe('Customer moved the collection date');
    expect(change.changedById).toBe(md.id);
    expect(change.oldDeadline.toISOString()).toBe('2027-06-10T12:30:00.000Z');

    expect(await auditActionsFor(subtask.id)).toContain('SUBTASK_DEADLINE_CHANGED');
  });

  it('refuses a deadline identical to the current one', async () => {
    const subtask = await publishedSubtask();

    await expect(
      changeDeadline(
        subtask.id,
        { newDeadline: '2027-06-10T18:00', reason: 'No actual change' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('warns when the new deadline passes the job deadline, and accepts an override', async () => {
    const subtask = await publishedSubtask();

    await expect(
      changeDeadline(
        subtask.id,
        { newDeadline: '2027-07-20T18:00', reason: 'Slipped' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ details: { reason: 'DEADLINE_AFTER_JOB' } });

    await expect(
      changeDeadline(
        subtask.id,
        {
          newDeadline: '2027-07-20T18:00',
          reason: 'Slipped',
          deadlineOverrideReason: 'Job deadline will be renegotiated',
        },
        mdActor,
        ctx,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses to move the deadline of a completed subtask', async () => {
    const subtask = await publishedSubtask();
    await changeStatus(
      subtask.id,
      { action: 'COMPLETE' },
      { id: planningMember.id, role: 'MEMBER' },
      ctx,
    );

    await expect(
      changeDeadline(
        subtask.id,
        { newDeadline: '2027-06-18T18:00', reason: 'Too late now' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// Reassignment (FR-24)
// ---------------------------------------------------------------------------

describe('reassignSubtask', () => {
  it('moves the subtask and records both sides', async () => {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);

    const cover = await createTestUser({
      email: 'cover@jaraaglobal.com',
      name: 'Cover Member',
      departmentId: planning.id,
    });

    const updated = await reassignSubtask(
      planningSubtask.id,
      { assigneeId: cover.id, reason: 'Original assignee is on leave' },
      mdActor,
      ctx,
    );

    expect(updated.assigneeId).toBe(cover.id);

    const entry = (await auditRowsFor(planningSubtask.id)).find(
      (row) => row.action === 'SUBTASK_REASSIGNED',
    )!;
    expect(entry.before).toMatchObject({ assigneeId: planningMember.id });
    expect(entry.after).toMatchObject({
      assigneeId: cover.id,
      reason: 'Original assignee is on leave',
    });
  });

  it('refuses to reassign to the person who already holds it', async () => {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);

    await expect(
      reassignSubtask(
        planningSubtask.id,
        { assigneeId: planningMember.id, reason: 'No actual change' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('warns when the new assignee is in another department', async () => {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);

    await expect(
      reassignSubtask(
        planningSubtask.id,
        { assigneeId: purchaseMember.id, reason: 'Covering' },
        mdActor,
        ctx,
      ),
    ).rejects.toMatchObject({ details: { reason: 'ASSIGNEE_OUTSIDE_DEPARTMENT' } });
  });
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe('subtask visibility', () => {
  it('refuses to list subtasks of a job the member is not on', async () => {
    const job = await makeJob();
    await makeChain(job.id);

    const outsider = session(
      await createTestUser({ email: 'outsider@jaraaglobal.com', departmentId: purchase.id }),
    );

    await expect(listJobSubtasks(outsider, job.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets a member on the job see every subtask, including other departments', async () => {
    const job = await makeJob();
    await makeChain(job.id);

    // PDD section 13 question 3: sibling visibility removes the phone call
    // asking whether material has arrived.
    const subtasks = await listJobSubtasks(planningMember, job.id);
    expect(subtasks).toHaveLength(2);
    expect(subtasks.map((s) => s.department.code)).toEqual(['PLANNING', 'PURCHASE']);
  });

  it('orders subtasks by department shop-flow sequence', async () => {
    const job = await makeJob();
    await makeChain(job.id);

    const subtasks = await listJobSubtasks(md, job.id);
    expect(subtasks.map((s) => s.department.sequenceOrder)).toEqual([1, 2]);
  });

  it('derives isOverdue rather than storing it (I-08)', async () => {
    const job = await makeJob();
    const { planningSubtask } = await makeChain(job.id);
    await publishJob(job, mdActor, ctx);

    await testDb.subtask.update({
      where: { id: planningSubtask.id },
      data: { deadline: new Date('2020-01-01T00:00:00Z') },
    });

    const subtasks = await listJobSubtasks(md, job.id);
    const planningRow = subtasks.find((s) => s.id === planningSubtask.id)!;

    expect(planningRow.isOverdue).toBe(true);
    // Still PENDING — overdue is a condition, not a status.
    expect(planningRow.status).toBe('PENDING');
  });
});
