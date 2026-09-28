/**
 * M9 acceptance: "the audit viewer shows a full trace of one job from creation
 * to completion".
 *
 * The existing audit tests cover the viewer's mechanics — paging, filters,
 * facets, the date range — against synthetic `entity-N` rows. That proves the
 * query works and proves nothing about whether the system actually records a
 * job's life, which is what the criterion is really asking. A trace is only
 * worth anything if every step that mattered wrote a row, and the only way to
 * know is to drive a job through the real service layer and read back what the
 * viewer would show.
 *
 * So nothing here writes an audit row directly. Every row asserted on is a
 * side effect of `createJob`, `bulkCreateSubtasks`, `publishJob` and
 * `changeStatus` doing their ordinary work.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listAudit } from '@/lib/services/audit-query';
import { createJob, publishJob } from '@/lib/services/jobs';
import { bulkCreateSubtasks, changeStatus } from '@/lib/services/subtasks';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { restoreMail, useCapturingMail } from './helpers/mail';

const ctx = { ipAddress: '203.0.113.7' };

let md: Awaited<ReturnType<typeof createTestUser>>;
let member: Awaited<ReturnType<typeof createTestUser>>;
let production: Awaited<ReturnType<typeof createTestDepartment>>;

beforeEach(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  useCapturingMail();

  production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });
  md = await createTestUser({ email: 'md@example.com', role: 'MD' });
  member = await createTestUser({ email: 'member@example.com', departmentId: production.id });
});

afterAll(async () => {
  restoreMail();
  await resetAuthTables();
  await testDb.$disconnect();
});

/** Drives one job the whole way, exactly as the screens would. */
async function runJobToCompletion() {
  const mdActor = { id: md.id, role: 'MD' as const };
  const memberActor = { id: member.id, role: 'MEMBER' as const };

  const job = await createJob(
    {
      title: 'Lifecycle fixture — creation to completion',
      customerName: 'Acme Engineering',
      overallDeadline: '2027-06-20T18:00',
      priority: 'NORMAL',
    },
    mdActor,
    ctx,
  );

  const [subtask] = await bulkCreateSubtasks(
    job.id,
    {
      subtasks: [
        {
          departmentId: production.id,
          assigneeId: member.id,
          title: 'Machining and first-piece clearance',
          deadline: '2027-06-18T18:00',
          requiresApproval: false,
        },
      ],
    },
    mdActor,
    ctx,
  );

  await publishJob(job, mdActor, ctx);
  await changeStatus(subtask.id, { action: 'START' }, memberActor, ctx);
  await changeStatus(
    subtask.id,
    { action: 'COMPLETE', note: 'First piece cleared, batch run complete.' },
    memberActor,
    ctx,
  );

  return { job, subtask };
}

describe('the audit trail of one job, creation to completion', () => {
  it('records every step, and the job ends COMPLETED', async () => {
    const { job, subtask } = await runJobToCompletion();

    const finished = await testDb.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe('COMPLETED');
    expect(finished.completedAt).not.toBeNull();

    const rows = await testDb.auditLog.findMany({
      where: { entityId: { in: [job.id, subtask.id] } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, entityType: true, actorId: true },
    });

    const actions = rows.map((row) => row.action);

    // The shape of a life: created, planned, published, started, finished.
    expect(actions).toContain('JOB_CREATED');
    expect(actions).toContain('SUBTASK_CREATED');
    expect(actions).toContain('JOB_PUBLISHED');
    expect(actions).toContain('SUBTASK_STATUS_CHANGED');
    expect(actions).toContain('JOB_STATUS_RECOMPUTED');

    // Creation precedes publication precedes the work.
    expect(actions.indexOf('JOB_CREATED')).toBeLessThan(actions.indexOf('JOB_PUBLISHED'));
    expect(actions.indexOf('JOB_PUBLISHED')).toBeLessThan(
      actions.indexOf('SUBTASK_STATUS_CHANGED'),
    );

    // Every row is attributable. An unattributed governance row is not a trace.
    expect(rows.every((row) => row.actorId !== null)).toBe(true);
  });

  it('is reachable through the viewer the screen uses, filtered to this job', async () => {
    const { job } = await runJobToCompletion();

    const trace = await listAudit({ entityId: job.id });

    expect(trace.total).toBeGreaterThan(0);
    expect(trace.data.map((row) => row.action)).toContain('JOB_CREATED');
    // The viewer resolves the actor, so the trace reads as names not ids.
    expect(trace.data[0]).toHaveProperty('actor');
  });

  it('carries a readable before/after on the status change', async () => {
    const { subtask } = await runJobToCompletion();

    const change = await testDb.auditLog.findFirstOrThrow({
      where: { entityId: subtask.id, action: 'SUBTASK_STATUS_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });

    expect(change.before).toMatchObject({ status: 'IN_PROGRESS' });
    expect(change.after).toMatchObject({ status: 'COMPLETED' });
  });

  /**
   * Completion tells the MD, and that is part of what the trace demonstrates:
   * the right notification, to the right person, raised by the work itself.
   *
   * Asserted on the recipient rather than the send, because who a completion
   * mail is addressed to is the part that has bitten this project — a demo MD
   * on the roster made every one of these go to an address that does not
   * exist.
   */
  it('enqueues JOB_COMPLETED to the MD, and to nobody else', async () => {
    const { job } = await runJobToCompletion();

    const notifications = await testDb.notification.findMany({
      where: { type: 'JOB_COMPLETED', entityId: job.id },
      select: { status: true, user: { select: { email: true, role: true, isDemo: true } } },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].user.email).toBe(md.email);
    expect(notifications[0].user.role).toBe('MD');
    expect(notifications[0].user.isDemo).toBe(false);
  });
});
