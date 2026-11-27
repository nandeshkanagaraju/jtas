import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isJobManager } from '@/lib/auth/job-managers';
import { can } from '@/lib/auth/policy';
import type { SessionUser } from '@/lib/auth/session';
import { jobActivityFeed } from '@/lib/services/activity-feed';
import { getJob } from '@/lib/services/jobs';
import { getSubtask } from '@/lib/services/subtasks';
import {
  addMaterialCount,
  reportPeriod,
  jobMaterialTotals,
  listMaterialCounts,
  recordsMaterials,
} from '@/lib/services/material-service';
import { resetEnvCache } from '@/lib/utils/env';
import { formatIST, fromISTInput } from '@/lib/utils/time';
import { addMaterialCountSchema } from '@/lib/validation/materials';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };

let md: Awaited<ReturnType<typeof createTestUser>>;
let ravi: Awaited<ReturnType<typeof createTestUser>>;
let anita: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string };
let machining: { id: string };
let inspection: { id: string };
let purchasing: { id: string };

beforeEach(async () => {
  await resetAuthTables();

  const production = await createTestDepartment({
    code: 'PRODUCTION',
    name: 'Production',
    sequenceOrder: 2,
  });
  const qa = await createTestDepartment({ code: 'QA', name: 'QA', sequenceOrder: 3 });
  const purchase = await createTestDepartment({
    code: 'PURCHASE',
    name: 'Purchase',
    sequenceOrder: 1,
  });

  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'Managing Director' });
  ravi = await createTestUser({
    email: 'ravi@jaraaglobal.com',
    name: 'Ravi',
    departmentId: production.id,
  });
  anita = await createTestUser({
    email: 'anita@jaraaglobal.com',
    name: 'Anita',
    departmentId: qa.id,
  });
  const buyer = await createTestUser({
    email: 'buyer@jaraaglobal.com',
    name: 'Buyer',
    departmentId: purchase.id,
  });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0099',
      title: 'Flange batch',
      quantity: 120,
      overallDeadline: fromISTInput('2027-06-30T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });
  const make = (departmentId: string, assigneeId: string, title: string) =>
    testDb.subtask.create({
      data: { jobId: job.id, departmentId, assigneeId, title },
      select: { id: true },
    });
  purchasing = await make(purchase.id, buyer.id, 'Raise PO');
  machining = await make(production.id, ravi.id, 'Machining');
  inspection = await make(qa.id, anita.id, 'Final inspection');
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('material counts', () => {
  it('only Production, Quality and QA count material', () => {
    expect(['PRODUCTION', 'QUALITY', 'QA'].every(recordsMaterials)).toBe(true);
    expect(['PURCHASE', 'STORE', 'PLANNING', 'DISPATCH'].some(recordsMaterials)).toBe(false);
  });

  it('keeps every report and sums them against the job quantity', async () => {
    await addMaterialCount(
      machining.id,
      { acceptedQty: 50, rejectedQty: 2, note: 'Shift 1' },
      ravi,
      ctx,
    );
    await addMaterialCount(machining.id, { acceptedQty: 40, rejectedQty: 0 }, ravi, ctx);

    const result = await listMaterialCounts(machining.id);
    expect(result.jobQuantity).toBe(120);
    expect(result.totals).toEqual({ accepted: 90, rejected: 2 });
    expect(result.entries.map((entry) => entry.acceptedQty)).toEqual([40, 50]);
    expect(result.entries[1]).toMatchObject({
      note: 'Shift 1',
      recordedBy: { id: ravi.id, name: 'Ravi' },
    });

    const audit = await testDb.auditLog.findMany({ where: { action: 'MATERIAL_COUNT_RECORDED' } });
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.entityId === machining.id && row.actorId === ravi.id)).toBe(
      true,
    );
  });

  it('refuses departments that do not count material', async () => {
    await expect(
      addMaterialCount(purchasing.id, { acceptedQty: 1, rejectedQty: 0 }, md, ctx),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await testDb.materialCount.count()).toBe(0);
  });

  it('refuses cancelled tasks', async () => {
    await testDb.subtask.update({ where: { id: inspection.id }, data: { status: 'CANCELLED' } });
    await expect(
      addMaterialCount(inspection.id, { acceptedQty: 1, rejectedQty: 1 }, anita, ctx),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('totals each counting task on the job page, in shop order', async () => {
    await addMaterialCount(machining.id, { acceptedQty: 100, rejectedQty: 5 }, ravi, ctx);
    await addMaterialCount(inspection.id, { acceptedQty: 98, rejectedQty: 2 }, anita, ctx);
    await addMaterialCount(inspection.id, { acceptedQty: 0, rejectedQty: 1 }, md, ctx);

    expect(await jobMaterialTotals(job.id)).toEqual([
      {
        subtaskId: machining.id,
        subtaskTitle: 'Machining',
        department: 'Production',
        reports: 1,
        accepted: 100,
        rejected: 5,
      },
      {
        subtaskId: inspection.id,
        subtaskTitle: 'Final inspection',
        department: 'QA',
        reports: 2,
        accepted: 98,
        rejected: 3,
      },
    ]);
  });

  it('lets the holder and the MD record, not another department or admin', () => {
    const resource = {
      id: machining.id,
      jobId: job.id,
      assigneeId: ravi.id,
      departmentId: 'x',
      jobParticipantIds: [ravi.id, anita.id],
    };
    expect(can(ravi, 'materials:record', resource)).toBe(true);
    expect(can(md, 'materials:record', resource)).toBe(true);
    expect(can(anita, 'materials:record', resource)).toBe(false);
    expect(can({ ...md, role: 'ADMIN' }, 'materials:record', resource)).toBe(false);
  });

  it("stores the hourly slot on today's IST date", async () => {
    const created = await addMaterialCount(
      inspection.id,
      { acceptedQty: 5, rejectedQty: 2, timeFrom: '00:00', timeTo: '00:01' },
      anita,
      ctx,
    );
    expect(created.periodEnd!.getTime() - created.periodStart!.getTime()).toBe(60_000);
    const plain = await addMaterialCount(
      inspection.id,
      { acceptedQty: 1, rejectedQty: 0 },
      anita,
      ctx,
    );
    expect(plain.periodStart).toBeNull();
  });

  it('reads a slot on the day it is sent, rolling night slots over', () => {
    const now = fromISTInput('2026-11-26T17:45');
    expect(reportPeriod('16:00', '17:00', now)).toEqual({
      periodStart: fromISTInput('2026-11-26T16:00'),
      periodEnd: fromISTInput('2026-11-26T17:00'),
    });
    // Sent at 00:20 for last night's 23:00–00:00.
    expect(reportPeriod('23:00', '00:00', fromISTInput('2026-11-27T00:20'))).toEqual({
      periodStart: fromISTInput('2026-11-26T23:00'),
      periodEnd: fromISTInput('2026-11-27T00:00'),
    });
  });

  it('needs both times, in order, and not a whole shift by mistake', () => {
    const base = { acceptedQty: 1, rejectedQty: 0 };
    expect(addMaterialCountSchema.safeParse({ ...base, timeFrom: '09:00' }).success).toBe(false);
    expect(
      addMaterialCountSchema.safeParse({ ...base, timeFrom: '09:00', timeTo: '09:00' }).success,
    ).toBe(false);
    expect(
      addMaterialCountSchema.safeParse({ ...base, timeFrom: '10:00', timeTo: '09:00' }).success,
    ).toBe(false);
    expect(
      addMaterialCountSchema.safeParse({ ...base, timeFrom: '9:00', timeTo: '10:00' }).success,
    ).toBe(false);
    expect(
      addMaterialCountSchema.safeParse({ ...base, timeFrom: '09:00', timeTo: '10:00' }).success,
    ).toBe(true);
  });

  it('rejects empty, negative and fractional quantities', () => {
    expect(addMaterialCountSchema.safeParse({ acceptedQty: 0, rejectedQty: 0 }).success).toBe(
      false,
    );
    expect(addMaterialCountSchema.safeParse({ acceptedQty: -1, rejectedQty: 3 }).success).toBe(
      false,
    );
    expect(addMaterialCountSchema.safeParse({ acceptedQty: 1.5, rejectedQty: 0 }).success).toBe(
      false,
    );
    expect(
      addMaterialCountSchema.parse({ acceptedQty: '12', rejectedQty: '0', note: '  ' }),
    ).toEqual({
      acceptedQty: 12,
      rejectedQty: 0,
      note: undefined,
    });
  });

  it('the database refuses a count of nothing even if the service were bypassed', async () => {
    await expect(
      testDb.materialCount.create({
        data: { subtaskId: machining.id, acceptedQty: 0, rejectedQty: 0, recordedById: md.id },
      }),
    ).rejects.toThrow();
  });

  describe('who sees the QA hourly reports', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      resetEnvCache();
    });

    function sessionOf(user: Awaited<ReturnType<typeof createTestUser>>): SessionUser {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
        isActive: user.isActive,
        mustChangePassword: false,
        productionSection: null,
        readsAllJobs: false,
        managesJobs: isJobManager(user),
      };
    }

    it('the MD and a Planning job manager off the job see every report, slot and the feed', async () => {
      // Dhiyaneswar's case: in Planning, a job manager, holding no task on this job.
      const planning = await createTestDepartment({
        code: 'PLANNING',
        name: 'Planning',
        sequenceOrder: 0,
      });
      const planner = await createTestUser({
        email: 'marketing@jaraaglobal.in',
        name: 'Dhiyaneswar S',
        departmentId: planning.id,
      });
      vi.stubEnv('JOB_MANAGER_EMAILS', 'marketing@jaraaglobal.in');
      resetEnvCache();

      await addMaterialCount(
        inspection.id,
        { acceptedQty: 40, rejectedQty: 1, note: 'burr on 1', timeFrom: '00:00', timeTo: '00:01' },
        anita,
        ctx,
      );
      await addMaterialCount(inspection.id, { acceptedQty: 38, rejectedQty: 0 }, anita, ctx);

      for (const viewer of [sessionOf(md), sessionOf(planner)]) {
        const subtask = await getSubtask(viewer, inspection.id);
        const resource = {
          id: subtask.id,
          jobId: job.id,
          assigneeId: subtask.assignee.id,
          departmentId: subtask.department.id,
          jobParticipantIds: [],
        };
        // The task page and GET /api/subtasks/:id/materials check exactly these.
        expect(can(viewer, 'subtask:view', resource)).toBe(true);
        expect(can(viewer, 'comment:view', resource)).toBe(true);

        const report = await listMaterialCounts(inspection.id);
        expect(report.totals).toEqual({ accepted: 78, rejected: 1 });
        expect(report.entries).toHaveLength(2);
        const slotted = report.entries.find((entry) => entry.periodStart);
        expect(slotted?.note).toBe('burr on 1');
        expect(slotted?.recordedBy.name).toBe('Anita');

        // The job page's totals and its updates feed.
        await getJob(viewer, job.id);
        const totals = await jobMaterialTotals(job.id);
        expect(totals.find((row) => row.subtaskId === inspection.id)).toMatchObject({
          accepted: 78,
          rejected: 1,
          reports: 2,
        });
        const feed = await jobActivityFeed(job.id);
        const lines = feed
          .filter((item) => item.action === 'MATERIAL_COUNT_RECORDED')
          .map((item) => item.body);
        expect(lines).toContain(
          `${formatIST(slotted!.periodStart!, 'h:mm a')}–${formatIST(slotted!.periodEnd!, 'h:mm a')} · Accepted 40 · Rejected 1 · burr on 1`,
        );
      }

      // Without the job-manager grant, Planning off the job sees nothing.
      vi.stubEnv('JOB_MANAGER_EMAILS', '');
      resetEnvCache();
      await expect(getSubtask(sessionOf(planner), inspection.id)).rejects.toThrow();
    });
  });
});
