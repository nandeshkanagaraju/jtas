import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { SessionUser } from '@/lib/auth/session';
import type { AppError } from '@/lib/errors';
import {
  cancelJob,
  createJob,
  getJob,
  holdJob,
  listJobs,
  loadJobForWrite,
  publishJob,
  recomputeJobStatus,
  unholdJob,
  updateJob,
} from '@/lib/services/jobs';
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
let member: SessionUser;
let production: Awaited<ReturnType<typeof createTestDepartment>>;

/** A deadline comfortably in the future, as the IST wall-clock string the API takes. */
const FUTURE = '2027-06-15T16:30';

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

  production = await createTestDepartment({ code: 'PRODUCTION', name: 'Production' });

  const mdRow = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD' });
  const memberRow = await createTestUser({
    email: 'member@jaraaglobal.com',
    departmentId: production.id,
  });

  md = session(mdRow);
  member = session(memberRow);
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.jobCodeCounter.deleteMany();
  await testDb.$disconnect();
});

function listQuery(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    pageSize: 25,
    sort: 'overallDeadline' as const,
    direction: 'asc' as const,
    ...overrides,
  } as Parameters<typeof listJobs>[1];
}

/** Creates a job through the service, with sensible defaults. */
async function makeJob(overrides: Partial<Parameters<typeof createJob>[0]> = {}) {
  return createJob(
    {
      title: 'Spindle housing batch',
      customerName: 'Acme Engineering',
      partNumber: 'SH-4410',
      drawingNumber: 'DRG-4410-B',
      quantity: 50,
      priority: 'NORMAL',
      description: 'EN8 bar, 40 mm.',
      overallDeadline: FUTURE,
      ...overrides,
    },
    { id: md.id, role: 'MD' as const },
    ctx,
  );
}

/** Adds a subtask so a job can be published. */
async function addSubtask(jobId: string, deadline = new Date('2027-06-10T12:00:00Z')) {
  return testDb.subtask.create({
    data: {
      jobId,
      departmentId: production.id,
      assigneeId: member.id,
      title: 'Machining and first-piece clearance',
      deadline,
      status: 'PENDING',
    },
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createJob', () => {
  it('creates a DRAFT with a generated code and audits it', async () => {
    const job = await makeJob();

    expect(job.jobCode).toMatch(/^JGE-\d{4}-\d{4}$/);
    expect(job.status).toBe('DRAFT');
    expect(job.publishedAt).toBeNull();
    expect(job.createdById).toBe(md.id);

    const [entry] = await auditRowsFor(job.id);
    expect(entry.action).toBe('JOB_CREATED');
    expect(entry.ipAddress).toBe('203.0.113.7');
    expect(entry.after).toMatchObject({ jobCode: job.jobCode, status: 'DRAFT' });
  });

  it('reads the deadline as IST, not as the server timezone', async () => {
    // 16:30 IST is 11:00 UTC. Built with new Date() on a UTC server this would
    // have been 16:30 UTC — five and a half hours late, every time.
    const job = await makeJob({ overallDeadline: '2027-06-15T16:30' });

    expect(job.overallDeadline.toISOString()).toBe('2027-06-15T11:00:00.000Z');
    expect(formatIST(job.overallDeadline, 'yyyy-MM-dd HH:mm')).toBe('2027-06-15 16:30');
  });

  it('refuses a deadline in the past', async () => {
    const error = (await makeJob({ overallDeadline: '2020-01-01T09:00' }).catch(
      (e: AppError) => e,
    )) as AppError;

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(
      (error.details as { fields: Record<string, string[]> }).fields.overallDeadline,
    ).toBeDefined();
  });

  it('numbers jobs sequentially within a year', async () => {
    const first = await makeJob();
    const second = await makeJob();

    expect(first.jobCode.endsWith('0001')).toBe(true);
    expect(second.jobCode.endsWith('0002')).toBe(true);
  });

  it('stores optional fields as null rather than empty strings', async () => {
    const job = await makeJob({
      customerName: undefined,
      partNumber: undefined,
      drawingNumber: undefined,
      quantity: undefined,
      description: undefined,
    });

    expect(job.customerName).toBeNull();
    expect(job.partNumber).toBeNull();
    expect(job.quantity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — draft, edit, cannot publish without subtasks
// ---------------------------------------------------------------------------

describe('acceptance: MD creates a draft, edits it, cannot publish it empty', () => {
  it('edits every field while the job is a draft', async () => {
    const job = await makeJob();

    const updated = await updateJob(
      job,
      {
        title: 'Spindle housing batch — revised',
        quantity: 75,
        partNumber: 'SH-4410-R1',
        overallDeadline: '2027-07-01T09:00',
        priority: 'HIGH',
      },
      { id: md.id, role: 'MD' as const },
      ctx,
    );

    expect(updated.title).toBe('Spindle housing batch — revised');
    expect(updated.quantity).toBe(75);
    expect(updated.partNumber).toBe('SH-4410-R1');
    expect(updated.priority).toBe('HIGH');
    expect(updated.overallDeadline.toISOString()).toBe('2027-07-01T03:30:00.000Z');

    const entry = (await auditRowsFor(job.id)).find((row) => row.action === 'JOB_UPDATED')!;
    expect(entry.before).toMatchObject({ quantity: 50 });
    expect(entry.after).toMatchObject({ quantity: 75 });
  });

  it('refuses to publish a job with no subtasks, and says why', async () => {
    const job = await makeJob();

    const error = (await publishJob(job, { id: md.id, role: 'MD' as const }, ctx).catch(
      (e: AppError) => e,
    )) as AppError;

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.status).toBe(400);
    expect(error.message).toContain('no subtasks yet');
    expect(error.details).toMatchObject({ reason: 'NO_SUBTASKS', subtaskCount: 0 });

    // Still a draft, and nothing was published.
    const unchanged = await loadJobForWrite(job.id);
    expect(unchanged.status).toBe('DRAFT');
    expect(unchanged.publishedAt).toBeNull();
    expect(await auditActionsFor(job.id)).not.toContain('JOB_PUBLISHED');
  });

  it('publishes once a subtask exists', async () => {
    const job = await makeJob();
    await addSubtask(job.id);

    const published = await publishJob(job, { id: md.id, role: 'MD' as const }, ctx);

    expect(published.status).toBe('IN_PROGRESS');
    expect(published.publishedAt).not.toBeNull();

    const entry = (await auditRowsFor(job.id)).find((row) => row.action === 'JOB_PUBLISHED')!;
    expect(entry.after).toMatchObject({ status: 'IN_PROGRESS', subtaskCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — a member cannot see a draft job at all
// ---------------------------------------------------------------------------

describe('acceptance: a member cannot see a job they have no subtask on', () => {
  it('is absent from the member list and 404 on detail', async () => {
    const job = await makeJob();

    const mdList = await listJobs(md, listQuery());
    expect(mdList.data.map((row) => row.id)).toContain(job.id);
    expect(mdList.total).toBe(1);

    const memberList = await listJobs(member, listQuery());
    expect(memberList.data).toHaveLength(0);
    // The count is scoped too — a leaked total would reveal how much work exists.
    expect(memberList.total).toBe(0);

    // NOT_FOUND rather than FORBIDDEN: confirming the job exists is information.
    await expect(getJob(member, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('becomes visible once the member holds a subtask on it', async () => {
    const job = await makeJob();
    await addSubtask(job.id);

    const memberList = await listJobs(member, listQuery());
    expect(memberList.data.map((row) => row.id)).toEqual([job.id]);
    await expect(getJob(member, job.id)).resolves.toMatchObject({ id: job.id });
  });

  it('does not show a member a job assigned to somebody else', async () => {
    const other = await createTestUser({
      email: 'other@jaraaglobal.com',
      departmentId: production.id,
    });
    const job = await makeJob();
    await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: production.id,
        assigneeId: other.id,
        title: 'Somebody else’s task',
        deadline: new Date('2027-06-10T12:00:00Z'),
        status: 'PENDING',
      },
    });

    const memberList = await listJobs(member, listQuery());
    expect(memberList.data).toHaveLength(0);
    await expect(getJob(member, job.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets an ADMIN read every job', async () => {
    const adminRow = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN' });
    const job = await makeJob();

    const adminList = await listJobs(session(adminRow), listQuery());
    expect(adminList.data.map((row) => row.id)).toContain(job.id);
  });
});

// ---------------------------------------------------------------------------
// Edit rules after publish
// ---------------------------------------------------------------------------

describe('editing a published job', () => {
  async function publishedJob() {
    const job = await makeJob();
    await addSubtask(job.id);
    await publishJob(job, { id: md.id, role: 'MD' as const }, ctx);
    return loadJobForWrite(job.id);
  }

  it('still accepts title, customer, priority and description', async () => {
    const job = await publishedJob();

    const updated = await updateJob(
      job,
      {
        title: 'Renamed after publish',
        customerName: 'Acme Engineering Ltd',
        priority: 'URGENT',
        description: 'Revised material note.',
      },
      { id: md.id, role: 'MD' as const },
      ctx,
    );

    expect(updated.title).toBe('Renamed after publish');
    expect(updated.priority).toBe('URGENT');
  });

  it('freezes part number, drawing, quantity and the overall deadline', async () => {
    const job = await publishedJob();

    for (const [field, value] of [
      ['partNumber', 'CHANGED'],
      ['drawingNumber', 'CHANGED'],
      ['quantity', 999],
      ['overallDeadline', '2027-08-01T09:00'],
    ] as const) {
      const error = (await updateJob(
        job,
        { [field]: value },
        { id: md.id, role: 'MD' as const },
        ctx,
      ).catch((e: AppError) => e)) as AppError;

      expect(error.code, field).toBe('VALIDATION_ERROR');
      expect((error.details as { frozenFields: string[] }).frozenFields, field).toContain(field);
    }
  });

  it('names every frozen field at once rather than one at a time', async () => {
    const job = await publishedJob();

    const error = (await updateJob(
      job,
      { quantity: 10, partNumber: 'X', title: 'Allowed' },
      { id: md.id, role: 'MD' as const },
      ctx,
    ).catch((e: AppError) => e)) as AppError;

    const details = error.details as { frozenFields: string[] };
    expect(details.frozenFields.sort()).toEqual(['partNumber', 'quantity']);
  });

  it('refuses any edit once the job is cancelled', async () => {
    const job = await publishedJob();
    await cancelJob(job, 'Customer withdrew the order', { id: md.id, role: 'MD' as const }, ctx);
    const cancelled = await loadJobForWrite(job.id);

    await expect(
      updateJob(cancelled, { title: 'Too late' }, { id: md.id, role: 'MD' as const }, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('job lifecycle', () => {
  async function publishedJob() {
    const job = await makeJob();
    await addSubtask(job.id);
    await publishJob(job, { id: md.id, role: 'MD' as const }, ctx);
    return loadJobForWrite(job.id);
  }

  it('refuses to publish twice', async () => {
    const job = await publishedJob();

    await expect(publishJob(job, { id: md.id, role: 'MD' as const }, ctx)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('holds a live job with a reason on the record', async () => {
    const job = await publishedJob();

    const held = await holdJob(
      job,
      'Customer paused the order',
      { id: md.id, role: 'MD' as const },
      ctx,
    );
    expect(held.status).toBe('ON_HOLD');

    const entry = (await auditRowsFor(job.id)).find((row) => row.action === 'JOB_HELD')!;
    expect(entry.after).toMatchObject({ reason: 'Customer paused the order' });
  });

  it('refuses to hold a draft, which has nothing to pause', async () => {
    const job = await makeJob();

    await expect(
      holdJob(job, 'Not yet', { id: md.id, role: 'MD' as const }, ctx),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('refuses to hold a job twice', async () => {
    const job = await publishedJob();
    await holdJob(job, 'Paused', { id: md.id, role: 'MD' as const }, ctx);
    const held = await loadJobForWrite(job.id);

    await expect(
      holdJob(held, 'Again', { id: md.id, role: 'MD' as const }, ctx),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('keeps a held job on hold even when a subtask goes overdue (FR-14)', async () => {
    const job = await publishedJob();
    await testDb.subtask.updateMany({
      where: { jobId: job.id },
      data: { deadline: new Date('2020-01-01T00:00:00Z') },
    });

    const held = await holdJob(job, 'Paused', { id: md.id, role: 'MD' as const }, ctx);
    expect(held.status).toBe('ON_HOLD');

    // Recomputing must not flip it to DELAYED — the hold would achieve nothing.
    await testDb.$transaction((tx) => recomputeJobStatus(tx, job.id));
    expect((await loadJobForWrite(job.id)).status).toBe('ON_HOLD');
  });

  it('recomputes rather than restores on unhold, because time passed', async () => {
    const job = await publishedJob();
    await holdJob(job, 'Paused', { id: md.id, role: 'MD' as const }, ctx);
    await testDb.subtask.updateMany({
      where: { jobId: job.id },
      data: { deadline: new Date('2020-01-01T00:00:00Z') },
    });

    const resumed = await unholdJob(
      await loadJobForWrite(job.id),
      { id: md.id, role: 'MD' as const },
      ctx,
    );

    expect(resumed.status).toBe('DELAYED');
    expect(await auditActionsFor(job.id)).toContain('JOB_UNHELD');
  });

  it('refuses to unhold a job that is not on hold', async () => {
    const job = await publishedJob();

    await expect(unholdJob(job, { id: md.id, role: 'MD' as const }, ctx)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('cancels the job and its open subtasks, never deleting anything', async () => {
    const job = await publishedJob();

    const cancelled = await cancelJob(
      job,
      'Customer withdrew',
      { id: md.id, role: 'MD' as const },
      ctx,
    );
    expect(cancelled.status).toBe('CANCELLED');

    // The open subtask went with it, so the sweeper stops chasing people.
    const subtasks = await testDb.subtask.findMany({ where: { jobId: job.id } });
    expect(subtasks.every((subtask) => subtask.status === 'CANCELLED')).toBe(true);

    // Rows are still there (rule 6).
    expect(await testDb.job.count({ where: { id: job.id } })).toBe(1);
    expect(subtasks.length).toBeGreaterThan(0);

    const entry = (await auditRowsFor(job.id)).find((row) => row.action === 'JOB_CANCELLED')!;
    expect(entry.after).toMatchObject({ reason: 'Customer withdrew', cancelledSubtaskCount: 1 });
  });

  it('leaves an already-completed subtask alone when cancelling', async () => {
    const job = await publishedJob();
    await testDb.subtask.updateMany({ where: { jobId: job.id }, data: { status: 'COMPLETED' } });
    const extra = await addSubtask(job.id);

    await cancelJob(
      await loadJobForWrite(job.id),
      'Withdrawn',
      { id: md.id, role: 'MD' as const },
      ctx,
    );

    const subtasks = await testDb.subtask.findMany({ where: { jobId: job.id } });
    expect(subtasks.find((s) => s.id === extra.id)!.status).toBe('CANCELLED');
    expect(subtasks.filter((s) => s.status === 'COMPLETED')).toHaveLength(1);
  });

  it('refuses to cancel a job twice', async () => {
    const job = await publishedJob();
    await cancelJob(job, 'Withdrawn', { id: md.id, role: 'MD' as const }, ctx);

    await expect(
      cancelJob(await loadJobForWrite(job.id), 'Again', { id: md.id, role: 'MD' as const }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

// ---------------------------------------------------------------------------
// recomputeJobStatus — the persistence wrapper
// ---------------------------------------------------------------------------

describe('recomputeJobStatus', () => {
  async function publishedJob() {
    const job = await makeJob();
    await addSubtask(job.id);
    await publishJob(job, { id: md.id, role: 'MD' as const }, ctx);
    return loadJobForWrite(job.id);
  }

  it('writes an audit row only when the status actually changes', async () => {
    const job = await publishedJob();
    const before = (await auditRowsFor(job.id)).filter(
      (row) => row.action === 'JOB_STATUS_RECOMPUTED',
    ).length;

    // Nothing changed, so nothing should be recorded.
    const unchanged = await testDb.$transaction((tx) => recomputeJobStatus(tx, job.id));
    expect(unchanged?.changed).toBe(false);

    const after = (await auditRowsFor(job.id)).filter(
      (row) => row.action === 'JOB_STATUS_RECOMPUTED',
    ).length;
    expect(after).toBe(before);
  });

  it('records the move when it does change', async () => {
    const job = await publishedJob();
    await testDb.subtask.updateMany({
      where: { jobId: job.id },
      data: { deadline: new Date('2020-01-01T00:00:00Z') },
    });

    const result = await testDb.$transaction((tx) =>
      recomputeJobStatus(tx, job.id, { actor: { id: md.id, role: 'MD' as const }, ctx }),
    );

    expect(result).toMatchObject({ previous: 'IN_PROGRESS', current: 'DELAYED', changed: true });

    const entry = (await auditRowsFor(job.id)).find(
      (row) => row.action === 'JOB_STATUS_RECOMPUTED',
    )!;
    expect(entry.before).toMatchObject({ status: 'IN_PROGRESS' });
    expect(entry.after).toMatchObject({ status: 'DELAYED' });
  });

  it('stamps completedAt when the job completes, and only once', async () => {
    const job = await publishedJob();
    await testDb.subtask.updateMany({ where: { jobId: job.id }, data: { status: 'COMPLETED' } });

    await testDb.$transaction((tx) => recomputeJobStatus(tx, job.id));

    const completed = await loadJobForWrite(job.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).not.toBeNull();

    const firstStamp = completed.completedAt!.toISOString();
    await testDb.$transaction((tx) => recomputeJobStatus(tx, job.id));
    expect((await loadJobForWrite(job.id)).completedAt!.toISOString()).toBe(firstStamp);
  });

  it('returns null for a job that does not exist', async () => {
    const result = await testDb.$transaction((tx) => recomputeJobStatus(tx, 'no-such-job'));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// List: filters, search, pagination
// ---------------------------------------------------------------------------

describe('listJobs', () => {
  beforeEach(async () => {
    await makeJob({
      title: 'Spindle housing',
      partNumber: 'SH-1',
      overallDeadline: '2027-01-10T10:00',
    });
    await makeJob({
      title: 'Gear blank',
      partNumber: 'GB-2',
      customerName: 'Beta Works',
      priority: 'URGENT',
      overallDeadline: '2027-02-10T10:00',
    });
    await makeJob({
      title: 'Flange plate',
      partNumber: 'FP-3',
      overallDeadline: '2027-03-10T10:00',
    });
  });

  it('sorts by overall deadline ascending by default', async () => {
    const result = await listJobs(md, listQuery());
    expect(result.data.map((job) => job.title)).toEqual([
      'Spindle housing',
      'Gear blank',
      'Flange plate',
    ]);
  });

  it('filters by status and priority', async () => {
    expect((await listJobs(md, listQuery({ status: 'DRAFT' }))).total).toBe(3);
    expect((await listJobs(md, listQuery({ status: 'IN_PROGRESS' }))).total).toBe(0);
    expect((await listJobs(md, listQuery({ priority: 'URGENT' }))).total).toBe(1);
  });

  it('searches job code, title, part number and customer', async () => {
    expect((await listJobs(md, listQuery({ q: 'spindle' }))).total).toBe(1);
    expect((await listJobs(md, listQuery({ q: 'GB-2' }))).total).toBe(1);
    expect((await listJobs(md, listQuery({ q: 'beta works' }))).total).toBe(1);
    expect((await listJobs(md, listQuery({ q: 'JGE-' }))).total).toBe(3);
    expect((await listJobs(md, listQuery({ q: 'nothing' }))).total).toBe(0);
  });

  it('filters by an IST deadline range, inclusive at both ends', async () => {
    const result = await listJobs(md, listQuery({ from: '2027-02-01', to: '2027-02-28' }));
    expect(result.data.map((job) => job.title)).toEqual(['Gear blank']);

    // The `to` boundary covers the whole IST day.
    const sameDay = await listJobs(md, listQuery({ from: '2027-02-10', to: '2027-02-10' }));
    expect(sameDay.total).toBe(1);
  });

  it('filters by the departments involved', async () => {
    const [first] = (await listJobs(md, listQuery())).data;
    await addSubtask(first.id);

    const quality = await createTestDepartment({ code: 'QUALITY', name: 'Quality' });

    expect((await listJobs(md, listQuery({ departmentId: production.id }))).total).toBe(1);
    expect((await listJobs(md, listQuery({ departmentId: quality.id }))).total).toBe(0);
  });

  it('paginates by cursor without repeating or dropping a row', async () => {
    const first = await listJobs(md, listQuery({ pageSize: 2 }));
    expect(first.data).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBe(first.data.at(-1)!.id);

    const second = await listJobs(md, listQuery({ pageSize: 2, cursor: first.nextCursor! }));
    expect(second.data).toHaveLength(1);
    // A short page means the list is exhausted.
    expect(second.nextCursor).toBeNull();

    const ids = new Set([...first.data, ...second.data].map((job) => job.id));
    expect(ids.size).toBe(3);
  });

  it('reports progress and involved departments', async () => {
    const [first] = (await listJobs(md, listQuery())).data;
    await addSubtask(first.id);
    await testDb.subtask.create({
      data: {
        jobId: first.id,
        departmentId: production.id,
        assigneeId: member.id,
        title: 'Second task',
        deadline: new Date('2027-06-10T12:00:00Z'),
        status: 'COMPLETED',
      },
    });

    const refreshed = (await listJobs(md, listQuery({ q: first.jobCode }))).data[0];
    expect(refreshed.progress).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(refreshed.departments.map((d) => d.code)).toEqual(['PRODUCTION']);
    expect(refreshed.hasOverdueSubtask).toBe(false);
  });

  it('flags an overdue subtask on the row', async () => {
    const [first] = (await listJobs(md, listQuery())).data;
    await addSubtask(first.id, new Date('2020-01-01T00:00:00Z'));

    const refreshed = (await listJobs(md, listQuery({ q: first.jobCode }))).data[0];
    expect(refreshed.hasOverdueSubtask).toBe(true);
  });
});
