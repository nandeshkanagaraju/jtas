import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addInvoice,
  billingDashboard,
  canManageBilling,
  jobBilling,
} from '@/lib/services/billing-service';
import { addMaterialCount } from '@/lib/services/material-service';
import { fromISTInput } from '@/lib/utils/time';

import { createTestDepartment, createTestUser, resetAuthTables, testDb } from './helpers/db';

const ctx = { ipAddress: '203.0.113.9' };

type User = Awaited<ReturnType<typeof createTestUser>>;
let md: User;
let accounts: User;
let ravi: User;
let anita: User;
let admin: User;
let job: { id: string };
let machining: { id: string };
let inspection: { id: string };
let dispatch: { id: string };
let depts: Record<string, string>;

const invoice = (number: string, quantity: number, date = '2026-11-20') => ({
  invoiceNumber: number,
  invoiceDate: date,
  quantity,
  rate: 125050,
  gstPercent: 1800,
});

beforeEach(async () => {
  await resetAuthTables();
  depts = {};
  for (const [code, order] of [
    ['PRODUCTION', 1],
    ['QUALITY', 2],
    ['QA', 3],
    ['DISPATCH', 4],
    ['ACCOUNTS', 5],
  ] as const) {
    depts[code] = (
      await createTestDepartment({
        code,
        name: code[0] + code.slice(1).toLowerCase(),
        sequenceOrder: order,
      })
    ).id;
  }
  md = await createTestUser({ email: 'md@jaraaglobal.com', role: 'MD', name: 'MD' });
  admin = await createTestUser({ email: 'admin@jaraaglobal.com', role: 'ADMIN', name: 'Admin' });
  accounts = await createTestUser({
    email: 'acc@jaraaglobal.com',
    name: 'Kalpana',
    departmentId: depts.ACCOUNTS,
  });
  ravi = await createTestUser({
    email: 'ravi@jaraaglobal.com',
    name: 'Ravi',
    departmentId: depts.PRODUCTION,
  });
  anita = await createTestUser({
    email: 'anita@jaraaglobal.com',
    name: 'Anita',
    departmentId: depts.QA,
  });

  job = await testDb.job.create({
    data: {
      jobCode: 'JGE-2026-0100',
      title: 'Manifold block',
      quantity: 24,
      overallDeadline: fromISTInput('2027-06-30T18:00'),
      createdById: md.id,
      status: 'IN_PROGRESS',
    },
    select: { id: true },
  });
  const make = (
    departmentId: string,
    assigneeId: string,
    title: string,
    status = 'IN_PROGRESS' as const,
  ) =>
    testDb.subtask.create({
      data: { jobId: job.id, departmentId, assigneeId, title, status },
      select: { id: true },
    });
  machining = await make(depts.PRODUCTION, ravi.id, 'Machining');
  inspection = await make(depts.QA, anita.id, 'Final inspection');
  dispatch = await make(depts.DISPATCH, md.id, 'Dispatch');
  await make(depts.ACCOUNTS, accounts.id, 'Invoice and payment');
});

afterAll(async () => {
  await resetAuthTables();
  await testDb.$disconnect();
});

describe('billing access', () => {
  it('is for Accounts, the MD and the Deputy only', async () => {
    expect(await canManageBilling(accounts)).toBe(true);
    expect(await canManageBilling(md)).toBe(true);
    expect(await canManageBilling({ role: 'DEPUTY_MD', departmentId: null })).toBe(true);
    expect(await canManageBilling(ravi)).toBe(false);
    expect(await canManageBilling(admin)).toBe(false);
  });
});

describe('billable quantity', () => {
  it('falls back to the job quantity before any inspection counts', async () => {
    const billing = await jobBilling(job.id);
    expect(billing.inspection).toMatchObject({ department: 'Qa', reports: 0 });
    expect(billing.billableBase).toBe(24);
    expect(billing.remaining).toBe(24);
  });

  it('uses final inspection (QA over Production) and subtracts what is invoiced', async () => {
    await addMaterialCount(machining.id, { acceptedQty: 24, rejectedQty: 0 }, ravi, ctx);
    await addMaterialCount(inspection.id, { acceptedQty: 22, rejectedQty: 2 }, anita, ctx);
    await addInvoice(job.id, invoice('INV-001', 10), accounts, ctx);

    const billing = await jobBilling(job.id);
    expect(billing.inspection).toMatchObject({ accepted: 22, rejected: 2, reports: 1 });
    expect(billing.billableBase).toBe(22);
    expect(billing.invoicedQuantity).toBe(10);
    expect(billing.remaining).toBe(12);
    expect(billing.totals).toEqual({
      taxablePaise: 1250500,
      gstPaise: 225090,
      totalPaise: 1475590,
    });
  });
});

describe('invoices', () => {
  it('refuses a duplicate number and draft or cancelled jobs', async () => {
    await addInvoice(job.id, invoice('INV-002', 5), accounts, ctx);
    await expect(addInvoice(job.id, invoice('INV-002', 1), accounts, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await testDb.job.update({ where: { id: job.id }, data: { status: 'CANCELLED' } });
    await expect(addInvoice(job.id, invoice('INV-003', 1), accounts, ctx)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('audits the number and quantity but never the money', async () => {
    await addInvoice(job.id, invoice('INV-004', 6), accounts, ctx);
    const row = await testDb.auditLog.findFirstOrThrow({ where: { action: 'INVOICE_RECORDED' } });
    expect(row).toMatchObject({ entityType: 'JOB', entityId: job.id, actorId: accounts.id });
    expect(row.after).toEqual({
      invoiceId: expect.any(String),
      invoiceNumber: 'INV-004',
      quantity: 6,
    });
  });

  it('stores the date as the IST calendar day', async () => {
    const created = await addInvoice(job.id, invoice('INV-005', 1, '2026-11-25'), accounts, ctx);
    expect(created.invoiceDate.toISOString()).toBe('2026-11-24T18:30:00.000Z');
  });
});

describe('billing dashboard', () => {
  it('lists dispatched jobs with pieces left to invoice and totals the month', async () => {
    const now = fromISTInput('2026-11-25T10:00');
    expect((await billingDashboard(now)).ready).toEqual([]); // not dispatched yet

    await testDb.subtask.update({ where: { id: dispatch.id }, data: { status: 'COMPLETED' } });
    await addMaterialCount(inspection.id, { acceptedQty: 20, rejectedQty: 4 }, anita, ctx);
    await addInvoice(job.id, invoice('INV-010', 8, '2026-11-20'), accounts, ctx);
    await addInvoice(job.id, invoice('INV-009', 2, '2026-10-31'), accounts, ctx); // last month

    const dashboard = await billingDashboard(now);
    expect(dashboard.ready).toEqual([
      expect.objectContaining({
        jobCode: 'JGE-2026-0100',
        billableBase: 20,
        invoicedQuantity: 10,
        remaining: 10,
        dispatched: true,
        estimated: false,
      }),
    ]);
    expect(dashboard.month).toMatchObject({ invoices: 1, quantity: 8, taxablePaise: 1000400 });
    expect(dashboard.recent.map((row) => row.invoiceNumber)).toEqual(['INV-010', 'INV-009']);

    await addInvoice(job.id, invoice('INV-011', 10, '2026-11-24'), accounts, ctx);
    expect((await billingDashboard(now)).ready).toEqual([]); // fully invoiced
  });
});
