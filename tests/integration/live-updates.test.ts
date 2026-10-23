import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';
import { listLiveJobs, getLiveJob } from '@/lib/services/live-updates';
import { liveJobsQuerySchema, liveJobQuerySchema } from '@/lib/live-updates/validation';
import { addComment } from '@/lib/services/comment-service';

let md: Awaited<ReturnType<typeof createTestUser>>;
let member: Awaited<ReturnType<typeof createTestUser>>;
let peer: Awaited<ReturnType<typeof createTestUser>>;
let outsider: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string };
let first: { id: string };
let second: { id: string };
beforeEach(async () => {
  await resetAuthTables();
  const planning = await createTestDepartment({ code: 'PLANNING', sequenceOrder: 1 });
  const purchase = await createTestDepartment({ code: 'PURCHASE', sequenceOrder: 2 });
  md = await createTestUser({ role: 'MD' });
  member = await createTestUser({ departmentId: planning.id, name: 'Planning member' });
  peer = await createTestUser({ departmentId: purchase.id, name: 'Purchase member' });
  outsider = await createTestUser({ name: 'Unrelated person' });
  job = await testDb.job.create({
    data: {
      jobCode: 'LIVE-1',
      title: 'Shared live job',
      createdById: md.id,
      status: 'IN_PROGRESS',
      overallDeadline: new Date('2099-01-01'),
    },
  });
  first = await testDb.subtask.create({
    data: {
      jobId: job.id,
      title: 'Planning stage',
      departmentId: planning.id,
      assigneeId: member.id,
      status: 'COMPLETED',
    },
  });
  second = await testDb.subtask.create({
    data: {
      jobId: job.id,
      title: 'Purchase stage',
      departmentId: purchase.id,
      assigneeId: peer.id,
      status: 'IN_PROGRESS',
      dependsOnId: first.id,
    },
  });
  await testDb.job.create({
    data: {
      jobCode: 'PRIVATE',
      title: 'Unrelated confidential job',
      createdById: outsider.id,
      status: 'IN_PROGRESS',
      overallDeadline: new Date('2099-01-01'),
    },
  });
});
const all = () => liveJobQuerySchema.parse({});
describe('shared live job centre', () => {
  it('scopes list totals, search, snapshots and comments to the job participants', async () => {
    const list = await listLiveJobs(member, liveJobsQuerySchema.parse({}));
    expect(list.total).toBe(1);
    expect(list.data[0].currentDepartments).toEqual(['PURCHASE']);
    expect(
      (await listLiveJobs(member, liveJobsQuerySchema.parse({ q: 'confidential' }))).total,
    ).toBe(0);
    await expect(getLiveJob(outsider, job.id, all())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await addComment(second.id, 'Material is arriving tomorrow. Shared across departments.', peer, {
      ipAddress: '203.0.113.99',
    });
    const snapshot = await getLiveJob(member, job.id, all());
    expect(snapshot.stages.map((stage) => stage.id)).toEqual([first.id, second.id]);
    expect(snapshot.job.progress).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(snapshot.stages[1]).toMatchObject({
      current: true,
      canComment: true,
      dependsOnId: first.id,
    });
    expect(snapshot.events[0]).toMatchObject({
      kind: 'comment',
      body: 'Material is arriving tomorrow. Shared across departments.',
      actor: { name: 'Purchase member' },
      subtask: { department: 'PURCHASE' },
    });
    expect(JSON.stringify(snapshot)).not.toContain('203.0.113.99');
    expect(JSON.stringify(snapshot)).not.toContain(member.passwordHash);
  });
  it('enforces stage boundaries and keeps admin collaboration read-only', async () => {
    await expect(
      getLiveJob(member, job.id, liveJobQuerySchema.parse({ taskId: 'foreign-stage' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const admin = await createTestUser({ role: 'ADMIN' });
    expect(
      (await getLiveJob(admin, job.id, all())).stages.every((stage) => !stage.canComment),
    ).toBe(true);
  });
  it('filters messages by department and keeps internal audit fields out', async () => {
    await addComment(first.id, 'Planning approved this drawing for the shop.', member, {
      ipAddress: null,
    });
    await addComment(second.id, 'Purchase material update for everyone.', peer, {
      ipAddress: null,
    });
    await testDb.auditLog.create({
      data: {
        entityType: 'SUBTASK',
        entityId: second.id,
        action: 'SUBTASK_UPDATED',
        after: {
          storageKey: 'PRIVATE_STORAGE_KEY',
          status: 'IN_PROGRESS',
          reason: 'Approved material replacement',
        },
      },
    });
    const messages = await getLiveJob(
      member,
      job.id,
      liveJobQuerySchema.parse({ kind: 'messages', taskId: second.id }),
    );
    expect(messages.events).toHaveLength(1);
    expect(messages.events[0].body).toContain('Purchase');
    const workflow = await getLiveJob(
      member,
      job.id,
      liveJobQuerySchema.parse({ kind: 'workflow' }),
    );
    expect(workflow.events).toHaveLength(1);
    expect(JSON.stringify(workflow)).not.toContain('PRIVATE_STORAGE_KEY');
    expect(
      workflow.events[0].changes.some((change) => change.after === 'Approved material replacement'),
    ).toBe(true);
  });
  it('paginates equal timestamps without gaps, duplication or noisy recomputes', async () => {
    const at = new Date('2026-01-01T10:00:00.000Z');
    await testDb.auditLog.createMany({
      data: Array.from({ length: 85 }, () => ({
        entityType: 'SUBTASK',
        entityId: second.id,
        action: 'SUBTASK_STATUS_CHANGED',
        createdAt: at,
        after: { status: 'IN_PROGRESS' },
      })),
    });
    await testDb.auditLog.createMany({
      data: Array.from({ length: 50 }, () => ({
        entityType: 'JOB',
        entityId: job.id,
        action: 'JOB_STATUS_RECOMPUTED',
        createdAt: new Date('2026-01-02'),
      })),
    });
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await getLiveJob(member, job.id, liveJobQuerySchema.parse({ cursor }));
      expect(page.events.length).toBeLessThanOrEqual(40);
      for (const event of page.events) {
        expect(seen.has(event.id)).toBe(false);
        seen.add(event.id);
        expect(event.action).not.toBe('JOB_STATUS_RECOMPUTED');
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBe(85);
    await expect(
      getLiveJob(member, job.id, liveJobQuerySchema.parse({ cursor: 'invalid' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('reflects completed work and job holds rather than leaving a stale current owner', async () => {
    await testDb.job.update({ where: { id: job.id }, data: { status: 'ON_HOLD' } });
    expect((await getLiveJob(member, job.id, all())).stages.every((stage) => !stage.current)).toBe(
      true,
    );
    await testDb.subtask.update({ where: { id: second.id }, data: { status: 'COMPLETED' } });
    await testDb.job.update({ where: { id: job.id }, data: { status: 'COMPLETED' } });
    expect((await listLiveJobs(member, liveJobsQuerySchema.parse({}))).total).toBe(0);
    const done = await getLiveJob(member, job.id, all());
    expect(done.job.progress.percent).toBe(100);
    expect(done.job.currentDepartments).toEqual([]);
  });
});
