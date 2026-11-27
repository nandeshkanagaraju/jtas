/**
 * QA's hourly inspection report for one task on one IST day: every slot QA
 * sent, with the day's totals and the totals so far on the job.
 */
import { prisma } from '@/lib/db/prisma';
import { formatIST, istDateKey } from '@/lib/utils/time';

export interface HourlyRow {
  from: string | null;
  to: string | null;
  accepted: number;
  rejected: number;
  inspected: number;
  /** Rejected ÷ inspected, as a percentage to one decimal; null when nothing was inspected. */
  rejectionPct: number | null;
  note: string | null;
  recordedBy: string;
  recordedAt: Date;
}

export interface HourlyReport {
  date: string;
  job: {
    jobCode: string;
    title: string;
    customerName: string | null;
    partNumber: string | null;
    drawingNumber: string | null;
    quantity: number | null;
  };
  task: { title: string; department: string; inspector: string };
  rows: HourlyRow[];
  day: { accepted: number; rejected: number; inspected: number; rejectionPct: number | null };
  /** Everything QA reported on this task up to the end of `date`. */
  toDate: { accepted: number; rejected: number; inspected: number };
}

export function rejectionPct(rejected: number, inspected: number): number | null {
  return inspected === 0 ? null : Math.round((rejected / inspected) * 1000) / 10;
}

export async function hourlyReport(subtaskId: string, date: string): Promise<HourlyReport> {
  const subtask = await prisma.subtask.findUniqueOrThrow({
    where: { id: subtaskId },
    select: {
      title: true,
      department: { select: { name: true } },
      assignee: { select: { name: true } },
      job: {
        select: {
          jobCode: true,
          title: true,
          customerName: true,
          partNumber: true,
          drawingNumber: true,
          quantity: true,
        },
      },
      materialCounts: {
        orderBy: { createdAt: 'asc' },
        select: {
          acceptedQty: true,
          rejectedQty: true,
          note: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
          recordedBy: { select: { name: true } },
        },
      },
    },
  });

  const dayOf = (row: { periodStart: Date | null; createdAt: Date }) =>
    istDateKey(row.periodStart ?? row.createdAt);

  const onDay = subtask.materialCounts
    .filter((row) => dayOf(row) === date)
    .sort(
      (a, b) => (a.periodStart ?? a.createdAt).getTime() - (b.periodStart ?? b.createdAt).getTime(),
    );

  const rows: HourlyRow[] = onDay.map((row) => {
    const inspected = row.acceptedQty + row.rejectedQty;
    return {
      from: row.periodStart ? formatIST(row.periodStart, 'HH:mm') : null,
      to: row.periodEnd ? formatIST(row.periodEnd, 'HH:mm') : null,
      accepted: row.acceptedQty,
      rejected: row.rejectedQty,
      inspected,
      rejectionPct: rejectionPct(row.rejectedQty, inspected),
      note: row.note,
      recordedBy: row.recordedBy.name,
      recordedAt: row.createdAt,
    };
  });

  const accepted = rows.reduce((t, r) => t + r.accepted, 0);
  const rejected = rows.reduce((t, r) => t + r.rejected, 0);
  const upTo = subtask.materialCounts.filter((row) => dayOf(row) <= date);
  const accToDate = upTo.reduce((t, r) => t + r.acceptedQty, 0);
  const rejToDate = upTo.reduce((t, r) => t + r.rejectedQty, 0);

  return {
    date,
    job: subtask.job,
    task: {
      title: subtask.title,
      department: subtask.department.name,
      inspector: subtask.assignee.name,
    },
    rows,
    day: {
      accepted,
      rejected,
      inspected: accepted + rejected,
      rejectionPct: rejectionPct(rejected, accepted + rejected),
    },
    toDate: { accepted: accToDate, rejected: rejToDate, inspected: accToDate + rejToDate },
  };
}
