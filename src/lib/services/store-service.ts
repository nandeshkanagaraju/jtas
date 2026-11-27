/**
 * The store register — material in and out, typed in by Store on its task.
 *
 * Store works without a deadline (see department-rules): it keeps this register
 * every day, against the job's PR or PO, and each line is intimated to
 * Production and Planning in the same transaction. Append-only: a wrong line is
 * corrected by another line, so what Store told the floor stays on record.
 */
import type { PurchaseDocType, StoreDirection } from '@prisma/client';

import {
  STORE_DEPARTMENT_CODE,
  STORE_INTIMATION_DEPARTMENT_CODES,
} from '@/lib/domain/department-rules';
import { prisma } from '@/lib/db/prisma';
import { conflict, validationError } from '@/lib/errors';
import { intimationBody } from '@/lib/notifications/payloads';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyDepartments } from '@/lib/services/notification-service';
import { formatIST, IST_DATE_PATTERN } from '@/lib/utils/time';
import type { AddStoreEntryInput } from '@/lib/validation/store';

export interface StoreEntryRow {
  id: string;
  direction: StoreDirection;
  documentType: PurchaseDocType;
  documentNumber: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  material: string | null;
  quantity: number | null;
  note: string | null;
  recordedBy: { id: string; name: string };
  createdAt: Date;
}

const ENTRY_SELECT = {
  id: true,
  direction: true,
  documentType: true,
  documentNumber: true,
  supplierName: true,
  invoiceNumber: true,
  invoiceDate: true,
  material: true,
  quantity: true,
  note: true,
  createdAt: true,
  recordedBy: { select: { id: true, name: true } },
} as const;

export function keepsStoreRegister(departmentCode: string): boolean {
  return departmentCode === STORE_DEPARTMENT_CODE;
}

/** Every line on one Store task, newest first. */
export async function listStoreEntries(subtaskId: string): Promise<StoreEntryRow[]> {
  return prisma.storeEntry.findMany({
    where: { subtaskId },
    orderBy: { createdAt: 'desc' },
    select: ENTRY_SELECT,
  });
}

/** Every store line on a job, newest first, for the job page. */
export async function listJobStoreEntries(jobId: string): Promise<StoreEntryRow[]> {
  return prisma.storeEntry.findMany({
    where: { subtask: { jobId } },
    orderBy: { createdAt: 'desc' },
    select: ENTRY_SELECT,
  });
}

/** "YYYY-MM-DD" → the calendar date as stored in a DATE column. */
function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function directionLabel(direction: StoreDirection): string {
  return direction === 'INWARD' ? 'Material received' : 'Material issued';
}

/**
 * Records one line and tells Production and Planning. The caller has already
 * checked `materials:record` (the same people: the holder, the MD, the Deputy).
 *
 * @throws {AppError} `VALIDATION_ERROR` when the task is not a Store task,
 *   `CONFLICT` when it or its job is cancelled.
 */
export async function addStoreEntry(
  subtaskId: string,
  input: AddStoreEntryInput,
  actor: { id: string; name: string },
  ctx: { ipAddress?: string | null },
): Promise<StoreEntryRow> {
  const subtask = await prisma.subtask.findUniqueOrThrow({
    where: { id: subtaskId },
    select: {
      status: true,
      jobId: true,
      department: { select: { code: true, name: true } },
      job: { select: { status: true, jobCode: true, isDemo: true } },
    },
  });

  if (!keepsStoreRegister(subtask.department.code)) {
    throw validationError(`${subtask.department.name} tasks do not keep the store register.`);
  }
  if (subtask.status === 'CANCELLED' || subtask.job.status === 'CANCELLED') {
    throw conflict('This task is cancelled, so no more store entries can be recorded on it.');
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.storeEntry.create({
      data: {
        subtaskId,
        direction: input.direction,
        documentType: input.documentType,
        documentNumber: input.documentNumber ?? null,
        supplierName: input.supplierName ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceDate: input.invoiceDate ? calendarDate(input.invoiceDate) : null,
        material: input.material ?? null,
        quantity: input.quantity ?? null,
        note: input.note ?? null,
        recordedById: actor.id,
      },
      select: ENTRY_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'STORE_ENTRY_RECORDED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      after: {
        storeEntryId: created.id,
        direction: created.direction,
        documentType: created.documentType,
        documentNumber: created.documentNumber,
        supplierName: created.supplierName,
        invoiceNumber: created.invoiceNumber,
        invoiceDate: input.invoiceDate ?? null,
        material: created.material,
        quantity: created.quantity,
      },
      ipAddress: ctx.ipAddress ?? null,
    });

    if (!subtask.job.isDemo) {
      const against = `${created.documentType}${created.documentNumber ? ` ${created.documentNumber}` : ''}`;
      await notifyDepartments(tx, {
        jobId: subtask.jobId,
        departmentCodes: STORE_INTIMATION_DEPARTMENT_CODES,
        senderId: actor.id,
        subject: `Store: ${directionLabel(created.direction).toLowerCase()}`,
        body: intimationBody(`${actor.name} (Store)`, [
          ['Against', against],
          ['Supplier', created.supplierName],
          [
            'Invoice',
            created.invoiceNumber
              ? `${created.invoiceNumber}${created.invoiceDate ? ` dated ${formatIST(created.invoiceDate, IST_DATE_PATTERN)}` : ''}`
              : null,
          ],
          ['Material', created.material],
          ['Quantity', created.quantity === null ? null : String(created.quantity)],
          ['Note', created.note],
        ]),
        dedupeBase: `store-entry:${created.id}`,
      });
    }

    return created;
  });
}
