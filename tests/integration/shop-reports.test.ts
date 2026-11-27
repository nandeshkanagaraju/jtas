import ExcelJS from 'exceljs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { can } from '@/lib/auth/policy';
import { hourlyReportWorkbook, stockWorkbook } from '@/lib/services/shop-reports/excel';
import { hourlyReport } from '@/lib/services/shop-reports/hourly-report';
import { hourlyReportPdf, stockPdf } from '@/lib/services/shop-reports/pdf';
import {
  deleteStockMovement,
  recordStockMovement,
  setStockOpening,
  stockLedger,
} from '@/lib/services/shop-reports/stock-ledger';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.7' };
const at = (value: string) => fromISTInput(value);

let md: Awaited<ReturnType<typeof createTestUser>>;
let hari: Awaited<ReturnType<typeof createTestUser>>;
let mahadev: Awaited<ReturnType<typeof createTestUser>>;
let arun: Awaited<ReturnType<typeof createTestUser>>;
let job: { id: string };
let store: { id: string };
let qa: { id: string };

beforeEach(async () => {
  await resetAuthTables();

  const storeDept = await createTestDepartment({ code: 'STORE', name: 'Store', sequenceOrder: 1 });
  const qaDept = await createTestDepartment({ code: 'QA', name: 'QA', sequenceOrder: 2 });
  const productionDept = await createTestDepartment({
    code: 'PRODUCTION',
    name: 'Production',
    sequenceOrder: 3,
  });
  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'Managing Director' });
  hari = await createTestUser({
    email: 'stores@jaraaglobal.in',
    name: 'Hari',
    departmentId: storeDept.id,
  });
  mahadev = await createTestUser({
    email: 'qa@jaraaglobal.in',
    name: 'Mahadev',
    departmentId: qaDept.id,
  });

  arun = await createTestUser({
    email: 'production@jaraaglobal.in',
    name: 'Arun',
    departmentId: productionDept.id,
  });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0101',
      title: 'Cam',
      customerName: 'TVS',
      partNumber: '7843K-065CA0Y',
      quantity: 3000,
      overallDeadline: at('2026-12-31T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });
  store = await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: storeDept.id,
      assigneeId: hari.id,
      title: 'Store register',
    },
    select: { id: true },
  });
  qa = await testDb.subtask.create({
    data: {
      jobId: job.id,
      departmentId: qaDept.id,
      assigneeId: mahadev.id,
      title: 'Hourly inspection',
    },
    select: { id: true },
  });
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

async function receive(quantity: number, when: string) {
  await testDb.storeEntry.create({
    data: {
      subtaskId: store.id,
      direction: 'INWARD',
      documentType: 'PO',
      supplierName: 'Steel Co',
      quantity,
      recordedById: hari.id,
      createdAt: at(when),
    },
  });
}

async function inspect(
  accepted: number,
  rejected: number,
  from: string,
  to: string,
  note?: string,
) {
  await testDb.materialCount.create({
    data: {
      subtaskId: qa.id,
      acceptedQty: accepted,
      rejectedQty: rejected,
      note: note ?? null,
      periodStart: at(from),
      periodEnd: at(to),
      recordedById: mahadev.id,
      createdAt: at(to),
    },
  });
}

async function bill(quantity: number, date: string, number: string) {
  await testDb.invoice.create({
    data: {
      jobId: job.id,
      billType: 'SALES',
      invoiceNumber: number,
      invoiceDate: at(`${date}T00:00`),
      quantity,
      ratePaise: 10000,
      gstBasisPoints: 1800,
      createdById: md.id,
    },
  });
}

describe('daily stock ledger', () => {
  const produce = (quantity: number, date: string, by = arun) =>
    recordStockMovement({ kind: 'PRODUCED', partNumber: '7843K-065CA0Y', date, quantity }, by, ctx);
  const dispatch = (quantity: number, date: string, reference = 'DC-1') =>
    recordStockMovement(
      { kind: 'DISPATCHED', partNumber: '7843k-065ca0y ', date, quantity, reference },
      md,
      ctx,
    );

  it('2000 RM in, 1000 produced, 500 dispatched leaves 1000 RM and 500 FG; 500 more RM makes 1500', async () => {
    await receive(2000, '2026-11-02T10:00');
    await produce(1000, '2026-11-03');
    await dispatch(500, '2026-11-04');

    let ledger = await stockLedger('2026-11-01', '2026-11-04');
    let part = ledger.parts[0]!;
    expect(ledger.parts).toHaveLength(1);
    expect(part).toMatchObject({
      partNumber: '7843K-065CA0Y',
      partName: 'Cam',
      rmReceived: 2000,
      produced: 1000,
      dispatched: 500,
      closing: { rm: 1000, fg: 500 },
    });
    expect(part.days.map((d) => [d.date, d.rmBalance, d.fgBalance])).toEqual([
      ['2026-11-02', 2000, 0],
      ['2026-11-03', 1000, 1000],
      ['2026-11-04', 1000, 500],
    ]);
    expect(ledger.entries.map((e) => [e.kind, e.quantity, e.recordedBy.name])).toEqual([
      ['DISPATCHED', 500, 'Managing Director'],
      ['PRODUCED', 1000, 'Arun'],
    ]);

    await receive(500, '2026-11-05T11:00');
    ledger = await stockLedger('2026-11-05', '2026-11-05');
    part = ledger.parts[0]!;
    expect(part.opening).toEqual({ rm: 1000, fg: 500 });
    expect(part.closing).toEqual({ rm: 1500, fg: 500 });
  });

  it("Production's count on its job task moves stock by itself; rejects use up RM only", async () => {
    const productionDept = await testDb.department.findUniqueOrThrow({
      where: { code: 'PRODUCTION' },
    });
    const productionTask = await testDb.subtask.create({
      data: {
        jobId: job.id,
        departmentId: productionDept.id,
        assigneeId: arun.id,
        title: 'Machining',
      },
      select: { id: true },
    });
    await receive(2000, '2026-11-02T10:00');
    await testDb.materialCount.create({
      data: {
        subtaskId: productionTask.id,
        acceptedQty: 1000,
        rejectedQty: 20,
        note: 'batch 1',
        recordedById: arun.id,
        createdAt: at('2026-11-03T18:00'),
      },
    });
    await dispatch(500, '2026-11-04');

    const ledger = await stockLedger('2026-11-01', '2026-11-30');
    const part = ledger.parts[0]!;
    expect(part).toMatchObject({ produced: 1000, rejected: 20, dispatched: 500 });
    expect(part.closing).toEqual({ rm: 980, fg: 500 });
    expect(ledger.entries.find((e) => e.jobCode)).toMatchObject({
      jobCode: 'JGE-2026-0101',
      kind: 'PRODUCED',
      quantity: 1000,
      rejected: 20,
      date: '2026-11-03',
      partNumber: '7843K-065CA0Y',
    });
  });

  it('QA counts and Sales bills no longer move the stock', async () => {
    await receive(100, '2026-11-02T10:00');
    await inspect(90, 10, '2026-11-02T14:00', '2026-11-02T15:00');
    await bill(50, '2026-11-02', 'S-9');
    const part = (await stockLedger('2026-11-02', '2026-11-02')).parts[0]!;
    expect(part.closing).toEqual({ rm: 100, fg: 0 });
  });

  it('starts from the opening stock and ignores what came before its date', async () => {
    await receive(999, '2026-10-20T10:00'); // already inside the opening figure
    await setStockOpening(
      {
        partNumber: ' 7843k-065ca0y ',
        partName: 'Cam',
        asOfDate: '2026-11-01',
        rmQty: 1000,
        fgQty: 200,
      },
      hari,
      ctx,
    );
    await receive(500, '2026-11-02T10:00');
    await produce(300, '2026-11-02');
    await dispatch(400, '2026-11-02');

    const part = (await stockLedger('2026-11-01', '2026-11-30')).parts[0]!;
    expect(part.openingSet).toEqual({ asOfDate: '2026-11-01', rmQty: 1000, fgQty: 200 });
    expect(part.opening).toEqual({ rm: 1000, fg: 200 });
    expect(part.closing).toEqual({ rm: 1200, fg: 100 });

    const audit = await testDb.auditLog.findFirst({ where: { action: 'STOCK_OPENING_SET' } });
    expect(audit?.actorId).toBe(hari.id);
  });

  it('a mistaken line can be removed by whoever typed it or the MD, not by others', async () => {
    const line = await produce(70, '2026-11-02');
    await expect(deleteStockMovement(line.id, hari, ctx)).rejects.toThrow(/Only the person/);
    await deleteStockMovement(line.id, arun, ctx);
    expect(await testDb.stockMovement.count()).toBe(0);
    const again = await produce(70, '2026-11-02');
    await deleteStockMovement(again.id, md, ctx);
    expect(await testDb.auditLog.count({ where: { action: 'STOCK_MOVEMENT_REMOVED' } })).toBe(2);
  });

  it('builds the Excel and PDF stock statement with the same figures', async () => {
    await receive(2000, '2026-11-02T10:00');
    await produce(1000, '2026-11-03');
    const ledger = await stockLedger('2026-11-01', '2026-11-30');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await stockWorkbook(ledger).xlsx.writeBuffer());
    const summary = workbook.getWorksheet('Stock summary')!;
    const row = summary.getRow(6).values as unknown[];
    expect(row.slice(1)).toEqual([
      1,
      '7843K-065CA0Y',
      'Cam',
      'TVS',
      0,
      2000,
      1000,
      0,
      1000,
      0,
      0,
      1000,
    ]);
    expect(workbook.getWorksheet('Daily movement')!.rowCount).toBe(7);

    const pdf = await stockPdf(ledger);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('Store and Production see it; Production records output; Dhiyaneswar records dispatch', () => {
    const as = (user: typeof md, departmentCode: string | null, managesJobs = false) => ({
      ...user,
      departmentCode,
      managesJobs,
    });
    const store = as(hari, 'STORE');
    const production = as(arun, 'PRODUCTION');
    const planner = as(mahadev, 'PLANNING', true);
    const qaUser = as(mahadev, 'QA');

    for (const viewer of [md, store, production, planner]) {
      expect(can(viewer, 'stock:view', undefined)).toBe(true);
    }
    expect(can(qaUser, 'stock:view', undefined)).toBe(false);

    expect(can(production, 'stock:recordProduced', undefined)).toBe(true);
    expect(can(md, 'stock:recordProduced', undefined)).toBe(true);
    expect(can(store, 'stock:recordProduced', undefined)).toBe(false);
    expect(can(planner, 'stock:recordProduced', undefined)).toBe(false);

    expect(can(planner, 'stock:recordDispatch', undefined)).toBe(true);
    expect(can(md, 'stock:recordDispatch', undefined)).toBe(true);
    expect(can(production, 'stock:recordDispatch', undefined)).toBe(false);
    expect(can(store, 'stock:recordDispatch', undefined)).toBe(false);

    expect(can(store, 'stock:setOpening', undefined)).toBe(true);
    expect(can(production, 'stock:setOpening', undefined)).toBe(false);
  });
});

describe('QA hourly report file', () => {
  it("fills one day's slots in order, with the day and job-to-date totals", async () => {
    await inspect(50, 0, '2026-11-26T09:00', '2026-11-26T10:00');
    await inspect(48, 2, '2026-11-27T10:00', '2026-11-27T11:00', 'oversize bore');
    await inspect(45, 5, '2026-11-27T09:00', '2026-11-27T10:00');

    const report = await hourlyReport(qa.id, '2026-11-27');
    expect(report.rows.map((r) => [r.from, r.to, r.accepted, r.rejected])).toEqual([
      ['09:00', '10:00', 45, 5],
      ['10:00', '11:00', 48, 2],
    ]);
    expect(report.day).toEqual({ accepted: 93, rejected: 7, inspected: 100, rejectionPct: 7 });
    expect(report.toDate).toEqual({ accepted: 143, rejected: 7, inspected: 150 });
    expect(report.task.inspector).toBe('Mahadev');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await hourlyReportWorkbook(report).xlsx.writeBuffer());
    const sheet = workbook.getWorksheet('Hourly report')!;
    expect((sheet.getRow(8).values as unknown[]).slice(1, 9)).toEqual([
      2,
      '10:00',
      '11:00',
      50,
      48,
      2,
      4,
      'oversize bore',
    ]);
    expect((sheet.getRow(9).values as unknown[]).slice(1, 8)).toEqual([
      'Day total',
      '',
      '',
      100,
      93,
      7,
      7,
    ]);

    const pdf = await hourlyReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is downloadable by the MD and job managers only', () => {
    expect(can(md, 'shopReport:view', undefined)).toBe(true);
    expect(can({ ...mahadev, managesJobs: true }, 'shopReport:view', undefined)).toBe(true);
    expect(can(mahadev, 'shopReport:view', undefined)).toBe(false);
    expect(can(hari, 'shopReport:view', undefined)).toBe(false);
    expect(can({ ...md, role: 'ADMIN' }, 'shopReport:view', undefined)).toBe(false);
  });
});
