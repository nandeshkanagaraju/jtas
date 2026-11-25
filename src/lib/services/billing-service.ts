/**
 * Accounts billing: invoices raised against jobs, the quantity still billable,
 * and the dashboard that shows what is ready to invoice.
 *
 * Money is shown only to Accounts, the MD and the Deputy (`canManageBilling`).
 * The billable quantity comes from the final inspection step's accepted count
 * (QA if the job has a QA task, otherwise Quality, otherwise Production).
 */
import { prisma } from '@/lib/db/prisma';
import { invoiceAmounts, type InvoiceAmounts } from '@/lib/domain/money';
import { conflict, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { fromISTInput, startOfISTDay } from '@/lib/utils/time';
import type { AddInvoiceInput } from '@/lib/validation/invoice';

/** Final inspection, most authoritative first. */
const INSPECTION_ORDER = ['QA', 'QUALITY', 'PRODUCTION'] as const;

interface BillingSubject {
  role: string;
  departmentId: string | null;
}

/** Accounts department members, the MD and the Deputy. Admin runs the system, not the books. */
export async function canManageBilling(user: BillingSubject): Promise<boolean> {
  if (user.role === 'MD' || user.role === 'DEPUTY_MD') return true;
  if (user.role !== 'MEMBER' || !user.departmentId) return false;
  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { code: true },
  });
  return department?.code === 'ACCOUNTS';
}

export interface InvoiceRow extends InvoiceAmounts {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  quantity: number;
  ratePaise: number;
  gstBasisPoints: number;
  note: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

export interface JobBilling {
  jobId: string;
  jobCode: string;
  jobTitle: string;
  jobQuantity: number | null;
  /** The step the billable quantity is read from; null when the job has none. */
  inspection: { department: string; accepted: number; rejected: number; reports: number } | null;
  /** Accepted at final inspection when counts exist, otherwise the job quantity. */
  billableBase: number | null;
  invoicedQuantity: number;
  /** What is accepted but not yet invoiced; never negative. */
  remaining: number | null;
  totals: InvoiceAmounts;
  invoices: InvoiceRow[];
}

const INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  invoiceDate: true,
  quantity: true,
  ratePaise: true,
  gstBasisPoints: true,
  note: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  quantity: number;
  ratePaise: number;
  gstBasisPoints: number;
  note: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
};

function toRow(record: InvoiceRecord): InvoiceRow {
  return { ...record, ...invoiceAmounts(record.quantity, record.ratePaise, record.gstBasisPoints) };
}

function sumAmounts(rows: InvoiceAmounts[]): InvoiceAmounts {
  return rows.reduce(
    (total, row) => ({
      taxablePaise: total.taxablePaise + row.taxablePaise,
      gstPaise: total.gstPaise + row.gstPaise,
      totalPaise: total.totalPaise + row.totalPaise,
    }),
    { taxablePaise: 0, gstPaise: 0, totalPaise: 0 },
  );
}

type InspectionSubtask = {
  status: string;
  department: { code: string; name: string };
  materialCounts: Array<{ acceptedQty: number; rejectedQty: number }>;
};

/** The final inspection step and its counts, from a job's subtasks. */
export function finalInspection(subtasks: InspectionSubtask[]): JobBilling['inspection'] {
  for (const code of INSPECTION_ORDER) {
    const steps = subtasks.filter(
      (row) => row.department.code === code && row.status !== 'CANCELLED',
    );
    if (steps.length === 0) continue;
    const counts = steps.flatMap((row) => row.materialCounts);
    return {
      department: steps[0].department.name,
      accepted: counts.reduce((sum, row) => sum + row.acceptedQty, 0),
      rejected: counts.reduce((sum, row) => sum + row.rejectedQty, 0),
      reports: counts.length,
    };
  }
  return null;
}

function billableFrom(
  inspection: JobBilling['inspection'],
  jobQuantity: number | null,
): number | null {
  if (inspection && inspection.reports > 0) return inspection.accepted;
  return jobQuantity;
}

const BILLING_JOB_SELECT = {
  id: true,
  jobCode: true,
  title: true,
  quantity: true,
  status: true,
  subtasks: {
    select: {
      status: true,
      department: { select: { code: true, name: true } },
      materialCounts: { select: { acceptedQty: true, rejectedQty: true } },
    },
  },
  invoices: { select: INVOICE_SELECT, orderBy: { invoiceDate: 'desc' as const } },
} as const;

type BillingJobRecord = {
  id: string;
  jobCode: string;
  title: string;
  quantity: number | null;
  subtasks: InspectionSubtask[];
  invoices: InvoiceRecord[];
};

function toJobBilling(job: BillingJobRecord): JobBilling {
  const invoices = job.invoices.map(toRow);
  const inspection = finalInspection(job.subtasks);
  const billableBase = billableFrom(inspection, job.quantity);
  const invoicedQuantity = invoices.reduce((sum, row) => sum + row.quantity, 0);
  return {
    jobId: job.id,
    jobCode: job.jobCode,
    jobTitle: job.title,
    jobQuantity: job.quantity,
    inspection,
    billableBase,
    invoicedQuantity,
    remaining: billableBase === null ? null : Math.max(0, billableBase - invoicedQuantity),
    totals: sumAmounts(invoices),
    invoices,
  };
}

/** Everything the billing panel on a job needs. The caller checks visibility and `canManageBilling`. */
export async function jobBilling(jobId: string): Promise<JobBilling> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: BILLING_JOB_SELECT,
  });
  return toJobBilling(job);
}

/**
 * Records one invoice. The caller has checked `canManageBilling`.
 *
 * @throws {AppError} `CONFLICT` for a duplicate invoice number or a draft or
 *   cancelled job; `VALIDATION_ERROR` for an unreadable date.
 */
export async function addInvoice(
  jobId: string,
  input: AddInvoiceInput,
  actor: { id: string },
  ctx: { ipAddress?: string | null },
): Promise<InvoiceRow> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { status: true },
  });
  if (job.status === 'DRAFT' || job.status === 'CANCELLED') {
    throw conflict(
      job.status === 'DRAFT'
        ? 'This job has not been published, so it cannot be invoiced yet.'
        : 'This job is cancelled, so it cannot be invoiced.',
    );
  }

  let invoiceDate: Date;
  try {
    invoiceDate = fromISTInput(`${input.invoiceDate}T00:00`);
  } catch {
    throw validationError('Enter a valid invoice date.', {
      fields: { invoiceDate: ['Invalid date'] },
    });
  }

  const existing = await prisma.invoice.findUnique({
    where: { invoiceNumber: input.invoiceNumber },
    select: { id: true },
  });
  if (existing) {
    throw conflict(`Invoice ${input.invoiceNumber} is already recorded.`, {
      fields: { invoiceNumber: ['Already used'] },
    });
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        jobId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate,
        quantity: input.quantity,
        ratePaise: input.rate,
        gstBasisPoints: input.gstPercent,
        note: input.note ?? null,
        createdById: actor.id,
      },
      select: INVOICE_SELECT,
    });

    // The job's activity feed is read by every department on the job, so the
    // audit row records the invoice number and quantity, never the money.
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'INVOICE_RECORDED',
      entityType: 'JOB',
      entityId: jobId,
      after: {
        invoiceId: created.id,
        invoiceNumber: created.invoiceNumber,
        quantity: created.quantity,
      },
      ipAddress: ctx.ipAddress ?? null,
    });

    return toRow(created);
  });
}

export interface ReadyToInvoice {
  jobId: string;
  jobCode: string;
  jobTitle: string;
  status: string;
  dispatched: boolean;
  inspectionDepartment: string | null;
  /** True when the billable figure is the job quantity because no counts were recorded. */
  estimated: boolean;
  billableBase: number;
  invoicedQuantity: number;
  remaining: number;
}

export interface RecentInvoice extends InvoiceRow {
  jobId: string;
  jobCode: string;
  jobTitle: string;
}

export interface BillingDashboard {
  ready: ReadyToInvoice[];
  recent: RecentInvoice[];
  month: { invoices: number; quantity: number } & InvoiceAmounts;
  invoicedJobs: number;
}

/** First instant of the current month in IST. */
function startOfISTMonth(now: Date): Date {
  const day = startOfISTDay(now);
  const ist = new Date(day.getTime() + 330 * 60_000);
  const firstOfMonth = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-01T00:00`;
  return fromISTInput(firstOfMonth);
}

/**
 * The Accounts dashboard.
 *
 * Ready to invoice: published, not cancelled jobs whose Dispatch step is done
 * (or the job is complete) and which still have accepted pieces not invoiced.
 */
export async function billingDashboard(now: Date = new Date()): Promise<BillingDashboard> {
  const [jobs, recentRecords, monthRecords] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        OR: [
          { status: 'COMPLETED' },
          { subtasks: { some: { status: 'COMPLETED', department: { code: 'DISPATCH' } } } },
        ],
      },
      select: {
        ...BILLING_JOB_SELECT,
        subtasks: {
          select: {
            status: true,
            department: { select: { code: true, name: true } },
            materialCounts: { select: { acceptedQty: true, rejectedQty: true } },
          },
        },
      },
      orderBy: { overallDeadline: 'asc' },
    }),
    prisma.invoice.findMany({
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { ...INVOICE_SELECT, job: { select: { id: true, jobCode: true, title: true } } },
    }),
    prisma.invoice.findMany({
      where: { invoiceDate: { gte: startOfISTMonth(now) } },
      select: { quantity: true, ratePaise: true, gstBasisPoints: true, jobId: true },
    }),
  ]);

  const ready: ReadyToInvoice[] = [];
  for (const job of jobs) {
    const billing = toJobBilling(job);
    if (billing.billableBase === null || !billing.remaining) continue;
    ready.push({
      jobId: job.id,
      jobCode: job.jobCode,
      jobTitle: job.title,
      status: job.status,
      dispatched: job.subtasks.some(
        (row) => row.department.code === 'DISPATCH' && row.status === 'COMPLETED',
      ),
      inspectionDepartment: billing.inspection?.department ?? null,
      estimated: !(billing.inspection && billing.inspection.reports > 0),
      billableBase: billing.billableBase,
      invoicedQuantity: billing.invoicedQuantity,
      remaining: billing.remaining,
    });
  }

  const monthAmounts = monthRecords.map((row) =>
    invoiceAmounts(row.quantity, row.ratePaise, row.gstBasisPoints),
  );

  return {
    ready,
    recent: recentRecords.map(({ job, ...record }) => ({
      ...toRow(record),
      jobId: job.id,
      jobCode: job.jobCode,
      jobTitle: job.title,
    })),
    month: {
      invoices: monthRecords.length,
      quantity: monthRecords.reduce((sum, row) => sum + row.quantity, 0),
      ...sumAmounts(monthAmounts),
    },
    invoicedJobs: new Set(monthRecords.map((row) => row.jobId)).size,
  };
}
