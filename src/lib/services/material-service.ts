/**
 * Accepted and rejected material counts — reported by Production, Quality and
 * QA on their own tasks.
 *
 * Append-only, like comments: each report is a row (a shift, a batch), the
 * totals are the sum, and a wrong figure is corrected by another report rather
 * than an edit, so the record of what was said stays intact.
 */
import { prisma } from '@/lib/db/prisma';
import { conflict, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { fromISTInput, istDateKey } from '@/lib/utils/time';
import { slotMinutes, type AddMaterialCountInput } from '@/lib/validation/materials';

const DAY_MS = 24 * 60 * 60_000;

/** Department codes whose tasks carry accepted/rejected counts. */
export const MATERIAL_DEPARTMENT_CODES = ['PRODUCTION', 'QUALITY', 'QA'] as const;

export function recordsMaterials(departmentCode: string): boolean {
  return (MATERIAL_DEPARTMENT_CODES as readonly string[]).includes(departmentCode);
}

export interface MaterialTotals {
  accepted: number;
  rejected: number;
}

export interface MaterialCountRow {
  id: string;
  acceptedQty: number;
  rejectedQty: number;
  note: string | null;
  /** The slot an hourly QA report covers; null when none was given. */
  periodStart: Date | null;
  periodEnd: Date | null;
  recordedBy: { id: string; name: string };
  createdAt: Date;
}

export interface SubtaskMaterials {
  /** The job's planned quantity, when one was entered. */
  jobQuantity: number | null;
  totals: MaterialTotals;
  entries: MaterialCountRow[];
}

export interface DepartmentMaterialTotals extends MaterialTotals {
  subtaskId: string;
  subtaskTitle: string;
  department: string;
  reports: number;
}

function sum(rows: Array<{ acceptedQty: number; rejectedQty: number }>): MaterialTotals {
  return rows.reduce(
    (total, row) => ({
      accepted: total.accepted + row.acceptedQty,
      rejected: total.rejected + row.rejectedQty,
    }),
    { accepted: 0, rejected: 0 },
  );
}

/** Every report on one task, newest first, with the totals. */
export async function listMaterialCounts(subtaskId: string): Promise<SubtaskMaterials> {
  const [subtask, entries] = await Promise.all([
    prisma.subtask.findUniqueOrThrow({
      where: { id: subtaskId },
      select: { job: { select: { quantity: true } } },
    }),
    prisma.materialCount.findMany({
      where: { subtaskId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        acceptedQty: true,
        rejectedQty: true,
        note: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        recordedBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  return { jobQuantity: subtask.job.quantity, totals: sum(entries), entries };
}

/**
 * The slot "HH:mm"–"HH:mm" on the IST day of `now`. A "to" at or before the
 * "from" ends the next day (a night slot); a slot that would start in the
 * future is the previous day's (23:00–00:00 sent at 00:20).
 */
export function reportPeriod(
  timeFrom: string,
  timeTo: string,
  now: Date = new Date(),
): { periodStart: Date; periodEnd: Date } {
  const day = istDateKey(now);
  let periodStart = fromISTInput(`${day}T${timeFrom}`);
  if (periodStart.getTime() > now.getTime()) periodStart = new Date(periodStart.getTime() - DAY_MS);
  const periodEnd = new Date(periodStart.getTime() + slotMinutes(timeFrom, timeTo) * 60_000);
  return { periodStart, periodEnd };
}

/**
 * Records one report. The caller has already checked `materials:record`.
 *
 * @throws {AppError} `VALIDATION_ERROR` when the task's department does not count
 *   materials, `CONFLICT` when the task or its job is cancelled.
 */
export async function addMaterialCount(
  subtaskId: string,
  input: AddMaterialCountInput,
  actor: { id: string },
  ctx: { ipAddress?: string | null },
): Promise<MaterialCountRow> {
  const subtask = await prisma.subtask.findUniqueOrThrow({
    where: { id: subtaskId },
    select: {
      status: true,
      department: { select: { code: true, name: true } },
      job: { select: { status: true } },
    },
  });

  if (!recordsMaterials(subtask.department.code)) {
    throw validationError(
      `${subtask.department.name} tasks do not record accepted and rejected material.`,
    );
  }
  if (subtask.status === 'CANCELLED' || subtask.job.status === 'CANCELLED') {
    throw conflict('This task is cancelled, so no more counts can be recorded on it.');
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.materialCount.create({
      data: {
        subtaskId,
        acceptedQty: input.acceptedQty,
        rejectedQty: input.rejectedQty,
        note: input.note ?? null,
        ...(input.timeFrom && input.timeTo ? reportPeriod(input.timeFrom, input.timeTo) : {}),
        recordedById: actor.id,
      },
      select: {
        id: true,
        acceptedQty: true,
        rejectedQty: true,
        note: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        recordedBy: { select: { id: true, name: true } },
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'MATERIAL_COUNT_RECORDED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      after: {
        materialCountId: created.id,
        acceptedQty: created.acceptedQty,
        rejectedQty: created.rejectedQty,
        note: created.note,
        ...(created.periodStart && created.periodEnd
          ? {
              periodStart: created.periodStart.toISOString(),
              periodEnd: created.periodEnd.toISOString(),
            }
          : {}),
      },
      ipAddress: ctx.ipAddress ?? null,
    });

    return created;
  });
}

/** Totals per counting task on a job, in shop order, for the job page. */
export async function jobMaterialTotals(jobId: string): Promise<DepartmentMaterialTotals[]> {
  const subtasks = await prisma.subtask.findMany({
    where: {
      jobId,
      status: { not: 'CANCELLED' },
      department: { code: { in: [...MATERIAL_DEPARTMENT_CODES] } },
    },
    orderBy: { department: { sequenceOrder: 'asc' } },
    select: {
      id: true,
      title: true,
      department: { select: { name: true } },
      materialCounts: { select: { acceptedQty: true, rejectedQty: true } },
    },
  });

  return subtasks.map((row) => ({
    subtaskId: row.id,
    subtaskTitle: row.title,
    department: row.department.name,
    reports: row.materialCounts.length,
    ...sum(row.materialCounts),
  }));
}
