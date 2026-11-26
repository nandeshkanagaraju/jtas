/**
 * The department rules from the November 2026 workflow change:
 * Store, QA and Accounts work without deadlines; Store keeps a register that is
 * intimated to Production and Planning; Production and Quality plan dated
 * batches; Planning intimates Accounts to invoice.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { intimateAccounts } from '@/lib/services/accounts-intimation';
import { closeBatch, listBatches, planBatches } from '@/lib/services/batch-service';
import { addStoreEntry } from '@/lib/services/store-service';
import { commitmentDueAt } from '@/lib/domain/commitment';
import { changeStatus, openCommitmentWindow } from '@/lib/services/subtasks';
import { buildPayload } from '@/lib/notifications/payloads';
import { addStoreEntrySchema } from '@/lib/validation/store';
import { fromISTInput, formatIST } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };
const future = (days: number) =>
  formatIST(new Date(Date.now() + days * 86_400_000), "yyyy-MM-dd'T'HH:mm");

let md: Awaited<ReturnType<typeof createTestUser>>;
let hari: Awaited<ReturnType<typeof createTestUser>>;
let arun: Awaited<ReturnType<typeof createTestUser>>;
let planner: Awaited<ReturnType<typeof createTestUser>>;
let sundar: Awaited<ReturnType<typeof createTestUser>>;
let kalpana: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string };
let store: { id: string };
let production: { id: string };
let quality: { id: string };
let accounts: { id: string };

beforeEach(async () => {
  await resetAuthTables();
  const dept = async (code: string, sequenceOrder: number) =>
    createTestDepartment({ code, name: code[0] + code.slice(1).toLowerCase(), sequenceOrder });
  const planning = await dept('PLANNING', 1);
  const storeDept = await dept('STORE', 3);
  const productionDept = await dept('PRODUCTION', 4);
  const qualityDept = await dept('QUALITY', 5);
  const accountsDept = await dept('ACCOUNTS', 7);

  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'MD' });
  planner = await createTestUser({
    email: 'pl@jaraaglobal.com',
    name: 'Dhiyaneswar',
    departmentId: planning.id,
  });
  hari = await createTestUser({
    email: 'st@jaraaglobal.com',
    name: 'Hari',
    departmentId: storeDept.id,
  });
  arun = await createTestUser({
    email: 'pr@jaraaglobal.com',
    name: 'Arun',
    departmentId: productionDept.id,
  });
  sundar = await createTestUser({
    email: 'qy@jaraaglobal.com',
    name: 'Sundaramurthy',
    departmentId: qualityDept.id,
  });
  kalpana = await createTestUser({
    email: 'ac@jaraaglobal.com',
    name: 'Kalpana',
    departmentId: accountsDept.id,
  });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0777',
      title: 'Flange batch',
      quantity: 100,
      overallDeadline: fromISTInput(future(60)),
      createdById: md.id,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });
  const make = (departmentId: string, assigneeId: string, title: string, dependsOnId?: string) =>
    testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId,
        assigneeId,
        title,
        dependsOnId,
        status: dependsOnId ? 'BLOCKED' : 'PENDING',
      },
      select: { id: true },
    });
  store = await make(storeDept.id, hari.id, 'Issue material');
  production = await make(productionDept.id, arun.id, 'Machining');
  quality = await make(qualityDept.id, sundar.id, 'Inspection', production.id);
  accounts = await make(accountsDept.id, kalpana.id, 'Invoice', quality.id);
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('departments without a deadline', () => {
  it('never opens a commitment window for Store', async () => {
    await openCommitmentWindow(testDb, store.id);
    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: store.id } });
    expect(row.commitmentDueAt).toBeNull();
    expect(await testDb.notification.count({ where: { entityId: store.id } })).toBe(0);
  });

  it('still opens one for Production', async () => {
    await openCommitmentWindow(testDb, production.id);
    const row = await testDb.subtask.findUniqueOrThrow({ where: { id: production.id } });
    expect(row.commitmentDueAt).not.toBeNull();
  });
});

describe('the store register', () => {
  it('needs supplier, invoice number and date for material received', () => {
    const result = addStoreEntrySchema.safeParse({ direction: 'INWARD', documentType: 'PO' });
    expect(result.success).toBe(false);
    expect(
      addStoreEntrySchema.safeParse({ direction: 'OUTWARD', documentType: 'PR' }).success,
    ).toBe(true);
  });

  it('records the line and intimates Production and Planning, not Store itself', async () => {
    const entry = await addStoreEntry(
      store.id,
      addStoreEntrySchema.parse({
        direction: 'INWARD',
        documentType: 'PO',
        documentNumber: '4512',
        supplierName: 'Sri Balaji Steels',
        invoiceNumber: 'SBS/1187',
        invoiceDate: '2026-11-25',
        quantity: '120',
      }),
      hari,
      ctx,
    );
    expect(entry.invoiceNumber).toBe('SBS/1187');

    const rows = await testDb.notification.findMany({
      where: { type: 'DEPARTMENT_INTIMATION', channel: 'EMAIL' },
    });
    expect(rows.map((row) => row.userId).sort()).toEqual([arun.id, planner.id].sort());

    const payload = await buildPayload(rows[0]!);
    expect(payload).toMatchObject({
      kind: 'DEPARTMENT_INTIMATION',
      headline: 'Store: material received',
    });
    expect(payload && 'facts' in payload ? payload.facts : []).toContainEqual([
      'Invoice',
      'SBS/1187 dated 25 Nov 2026',
    ]);
  });

  it('refuses a line on a task that is not Store', async () => {
    await expect(
      addStoreEntry(
        production.id,
        addStoreEntrySchema.parse({ direction: 'OUTWARD', documentType: 'PR' }),
        arun,
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('batch deadlines', () => {
  const actor = () => ({ id: arun.id, role: arun.role, managesTask: false });

  it('plans batches, mirrors the earliest open one, and moves on as each closes', async () => {
    await testDb.subtask.update({
      where: { id: production.id },
      data: { commitmentDueAt: commitmentDueAt(new Date()) },
    });

    const planned = await planBatches(
      production.id,
      {
        batches: [
          { quantity: 60, deadline: future(10) },
          { quantity: 40, deadline: future(5) },
        ],
      },
      actor(),
      ctx,
    );
    expect(planned.batches.map((b) => b.quantity)).toEqual([40, 60]);

    let row = await testDb.subtask.findUniqueOrThrow({ where: { id: production.id } });
    expect(row.deadline?.toISOString()).toBe(fromISTInput(future(5)).toISOString());
    expect(row.deadlineOrigin).toBe('DEPARTMENT');

    // The holder cannot re-plan; that is the MD's.
    await expect(
      planBatches(
        production.id,
        { batches: [{ quantity: 100, deadline: future(20) }] },
        actor(),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const first = planned.batches[0]!;
    await closeBatch(production.id, first.id, { acceptedQty: 38, rejectedQty: 2 }, arun, ctx);

    row = await testDb.subtask.findUniqueOrThrow({ where: { id: production.id } });
    expect(row.deadline?.toISOString()).toBe(fromISTInput(future(10)).toISOString());

    // Quality was waiting on Production; the first batch lets it start.
    const qualityRow = await testDb.subtask.findUniqueOrThrow({ where: { id: quality.id } });
    expect(qualityRow.status).toBe('PENDING');
    const started = await changeStatus(quality.id, { action: 'START' }, sundar, ctx);
    expect(started.subtask.status).toBe('IN_PROGRESS');
    // …but it cannot finish before Production does.
    await expect(
      changeStatus(quality.id, { action: 'COMPLETE' }, sundar, ctx),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const after = await listBatches(production.id);
    expect(after.batches[0]).toMatchObject({ acceptedQty: 38, rejectedQty: 2 });
    expect(await testDb.materialCount.count({ where: { subtaskId: production.id } })).toBe(1);
  });

  it('lets the MD re-plan open batches with a reason', async () => {
    await planBatches(
      production.id,
      { batches: [{ quantity: 100, deadline: future(5) }] },
      { id: md.id, role: md.role, managesTask: true },
      ctx,
    );
    await expect(
      planBatches(
        production.id,
        { batches: [{ quantity: 100, deadline: future(8) }] },
        { id: md.id, role: md.role, managesTask: true },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const replanned = await planBatches(
      production.id,
      {
        batches: [
          { quantity: 50, deadline: future(8) },
          { quantity: 50, deadline: future(9) },
        ],
        reason: 'Bar stock late',
      },
      { id: md.id, role: md.role, managesTask: true },
      ctx,
    );
    expect(replanned.batches).toHaveLength(2);
  });
});

describe('Planning intimates Accounts', () => {
  it('stamps the job and mails Accounts', async () => {
    await intimateAccounts(job.id, { note: '100 pcs, DC 221' }, planner, ctx);
    const row = await testDb.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.accountsIntimatedById).toBe(planner.id);
    expect(row.accountsIntimationNote).toBe('100 pcs, DC 221');

    const mails = await testDb.notification.findMany({
      where: { type: 'DEPARTMENT_INTIMATION', channel: 'EMAIL' },
    });
    expect(mails.map((mail) => mail.userId)).toEqual([kalpana.id]);
    expect(accounts.id).toBeTruthy();
  });

  it('refuses anyone outside Planning', async () => {
    await expect(intimateAccounts(job.id, {}, arun, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
