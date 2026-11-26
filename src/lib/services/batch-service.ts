/**
 * Batch deadlines for Production and Quality.
 *
 * Production cannot make the whole quantity at once, and Quality inspects each
 * lot on the day it goes, so their task carries several dated batches instead
 * of one finish date. The task's own `deadline` always mirrors the earliest
 * open batch: the reminder, the overdue chase and the job status all keep
 * working, one batch at a time. Closing a batch records its accepted and
 * rejected pieces (a `MaterialCount` row tied to the batch) and moves the
 * deadline on to the next one.
 *
 * Planning follows the commitment rule: the department plans its batches once,
 * when its turn arrives. After that, only the MD or a job manager re-plans the
 * open batches, with a reason.
 */
import type { Prisma } from '@prisma/client';

import { plansInBatches } from '@/lib/domain/department-rules';
import { prisma, type Db } from '@/lib/db/prisma';
import { conflict, forbidden, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import {
  notifyCommitmentMade,
  notifyDeadlineChange,
  rescheduleForSubtask,
} from '@/lib/services/notification-service';
import { unblockDependents } from '@/lib/services/subtasks/status';
import { assertDeadlineWithinJob, parseSubtaskDeadline } from '@/lib/services/subtasks/invariants';
import type { Actor, RequestContext } from '@/lib/services/subtasks/types';
import type { CloseBatchInput, PlanBatchesInput } from '@/lib/validation/batch';

export interface BatchRow {
  id: string;
  sequence: number;
  quantity: number;
  deadline: Date;
  completedAt: Date | null;
  /** Accepted and rejected pieces reported when the batch was closed. */
  acceptedQty: number;
  rejectedQty: number;
  note: string | null;
  closedBy: string | null;
}

export interface SubtaskBatches {
  jobQuantity: number | null;
  plannedQuantity: number;
  batches: BatchRow[];
}

const BATCH_SELECT = {
  id: true,
  sequence: true,
  quantity: true,
  deadline: true,
  completedAt: true,
  counts: {
    select: {
      acceptedQty: true,
      rejectedQty: true,
      note: true,
      recordedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.SubtaskBatchSelect;

type BatchRecord = Prisma.SubtaskBatchGetPayload<{ select: typeof BATCH_SELECT }>;

function toRow(batch: BatchRecord): BatchRow {
  return {
    id: batch.id,
    sequence: batch.sequence,
    quantity: batch.quantity,
    deadline: batch.deadline,
    completedAt: batch.completedAt,
    acceptedQty: batch.counts.reduce((sum, row) => sum + row.acceptedQty, 0),
    rejectedQty: batch.counts.reduce((sum, row) => sum + row.rejectedQty, 0),
    note:
      batch.counts
        .map((row) => row.note)
        .filter(Boolean)
        .join(' · ') || null,
    closedBy: batch.counts[0]?.recordedBy.name ?? null,
  };
}

export async function listBatches(subtaskId: string): Promise<SubtaskBatches> {
  const [subtask, batches] = await Promise.all([
    prisma.subtask.findUniqueOrThrow({
      where: { id: subtaskId },
      select: { job: { select: { quantity: true } } },
    }),
    prisma.subtaskBatch.findMany({
      where: { subtaskId },
      orderBy: { sequence: 'asc' },
      select: BATCH_SELECT,
    }),
  ]);
  return {
    jobQuantity: subtask.job.quantity,
    plannedQuantity: batches.reduce((sum, row) => sum + row.quantity, 0),
    batches: batches.map(toRow),
  };
}

/**
 * Points the task's deadline at its earliest open batch and restarts the
 * chase for it. With every batch closed, the deadline stays on the last one,
 * so the task is measured against it when it is marked completed.
 */
async function syncDeadline(
  tx: Db,
  subtaskId: string,
  origin: 'DEPARTMENT' | 'MD',
): Promise<{ before: Date | null; after: Date | null }> {
  const [subtask, next] = await Promise.all([
    tx.subtask.findUniqueOrThrow({ where: { id: subtaskId }, select: { deadline: true } }),
    tx.subtaskBatch.findFirst({
      where: { subtaskId, completedAt: null },
      orderBy: [{ deadline: 'asc' }, { sequence: 'asc' }],
      select: { deadline: true },
    }),
  ]);
  if (!next) return { before: subtask.deadline, after: subtask.deadline };
  if (subtask.deadline?.getTime() === next.deadline.getTime()) {
    return { before: subtask.deadline, after: subtask.deadline };
  }

  await tx.subtask.update({
    where: { id: subtaskId },
    data: {
      deadline: next.deadline,
      deadlineOrigin: origin,
      escalationCount: 0,
      lastEscalatedAt: null,
      commitmentEscalationCount: 0,
      commitmentLastEscalatedAt: null,
    },
  });
  await rescheduleForSubtask(tx, subtaskId);
  return { before: subtask.deadline, after: next.deadline };
}

/**
 * Plans (or, for the MD and job managers, re-plans) the open batches.
 *
 * @throws {AppError} `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`
 */
export async function planBatches(
  subtaskId: string,
  input: PlanBatchesInput,
  actor: Actor & { managesTask: boolean },
  ctx: RequestContext,
): Promise<SubtaskBatches> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      jobId: true,
      assigneeId: true,
      status: true,
      deadline: true,
      commitmentDueAt: true,
      department: { select: { code: true, name: true } },
      job: { select: { overallDeadline: true, status: true } },
      batches: { select: { id: true, sequence: true, completedAt: true } },
    },
  });
  if (!subtask) throw notFound('Subtask');

  if (!plansInBatches(subtask.department.code)) {
    throw validationError(`${subtask.department.name} tasks are not planned in batches.`);
  }
  if (subtask.status === 'COMPLETED' || subtask.status === 'CANCELLED') {
    throw validationError('This task is already closed.', { reason: 'SUBTASK_CLOSED' });
  }

  const isAssignee = actor.id === subtask.assigneeId;
  const replanning = subtask.batches.length > 0 || subtask.deadline !== null;

  if (replanning) {
    if (!actor.managesTask) {
      throw forbidden(
        'Your batch dates are already set. You cannot move them. Ask the MD for more time.',
      );
    }
    // Changing batches already planned goes on the record with a reason;
    // splitting a single committed date into batches for the first time does not.
    if (subtask.batches.length > 0 && !input.reason) {
      throw validationError('Give a short reason for changing the batches.', {
        fields: { reason: ['Give a short reason — it goes on the record.'] },
      });
    }
  } else if (isAssignee) {
    if (subtask.status === 'BLOCKED' || !subtask.commitmentDueAt) {
      throw validationError(
        'This task is not ready for dates yet. It plans when its turn arrives.',
        {
          reason: 'COMMITMENT_NOT_OPEN',
        },
      );
    }
  } else if (!actor.managesTask) {
    throw forbidden('Only the person who holds this task can plan its batches.');
  }

  const dates = input.batches.map((batch, index) => {
    const deadline = parseSubtaskDeadline(batch.deadline, { field: `batches.${index}.deadline` });
    assertDeadlineWithinJob(
      deadline,
      subtask.job.overallDeadline,
      input.deadlineOverrideReason,
      `batches.${index}.deadline`,
    );
    return { quantity: batch.quantity, deadline };
  });
  dates.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const closed = subtask.batches.filter((batch) => batch.completedAt !== null);
  const firstSequence = closed.reduce((max, batch) => Math.max(max, batch.sequence), 0) + 1;
  const origin = isAssignee && !replanning ? 'DEPARTMENT' : 'MD';

  await prisma.$transaction(async (tx) => {
    // Open batches have no counts yet, so replacing them loses nothing reported.
    await tx.subtaskBatch.deleteMany({ where: { subtaskId, completedAt: null } });
    await tx.subtaskBatch.createMany({
      data: dates.map((batch, index) => ({
        subtaskId,
        sequence: firstSequence + index,
        quantity: batch.quantity,
        deadline: batch.deadline,
        createdById: actor.id,
      })),
    });

    const { before, after } = await syncDeadline(tx, subtaskId, origin);

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'BATCHES_PLANNED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { deadline: before?.toISOString() ?? null },
      after: {
        deadline: after?.toISOString() ?? null,
        reason: input.reason ?? (origin === 'DEPARTMENT' ? 'Committed by the department' : null),
        batches: dates.map((batch, index) => ({
          sequence: firstSequence + index,
          quantity: batch.quantity,
          deadline: batch.deadline.toISOString(),
        })),
      },
      ipAddress: ctx.ipAddress,
      source: ctx.source ?? 'WEB',
    });

    if (after && before?.getTime() !== after.getTime()) {
      if (before === null) await notifyCommitmentMade(tx, subtaskId);
      else if (!isAssignee) await notifyDeadlineChange(tx, subtaskId);
    }
    await recomputeJobStatus(tx, subtask.jobId, { actor, ctx });
  });

  return listBatches(subtaskId);
}

/**
 * Closes one batch with its accepted and rejected pieces. The first batch
 * closed on a Production task lets Quality start inspecting.
 *
 * The caller has already checked `materials:record` on the task.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`
 */
export async function closeBatch(
  subtaskId: string,
  batchId: string,
  input: CloseBatchInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskBatches> {
  const batch = await prisma.subtaskBatch.findFirst({
    where: { id: batchId, subtaskId },
    select: {
      id: true,
      sequence: true,
      completedAt: true,
      subtask: {
        select: {
          status: true,
          jobId: true,
          deadlineOrigin: true,
          job: { select: { status: true } },
        },
      },
    },
  });
  if (!batch) throw notFound('Batch');
  if (batch.completedAt) throw conflict(`Batch ${batch.sequence} is already closed.`);
  if (batch.subtask.status === 'CANCELLED' || batch.subtask.job.status === 'CANCELLED') {
    throw conflict('This task is cancelled, so no more batches can be closed on it.');
  }
  if (batch.subtask.status === 'BLOCKED') {
    throw validationError('This task is not your turn yet.', { reason: 'SUBTASK_BLOCKED' });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const firstClosed =
      (await tx.subtaskBatch.count({ where: { subtaskId, completedAt: { not: null } } })) === 0;

    await tx.subtaskBatch.update({ where: { id: batchId }, data: { completedAt: now } });
    await tx.materialCount.create({
      data: {
        subtaskId,
        batchId,
        acceptedQty: input.acceptedQty,
        rejectedQty: input.rejectedQty,
        note: input.note ?? `Batch ${batch.sequence}`,
        recordedById: actor.id,
      },
    });

    await syncDeadline(tx, subtaskId, batch.subtask.deadlineOrigin ?? 'DEPARTMENT');

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'BATCH_COMPLETED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      after: {
        batchId,
        sequence: batch.sequence,
        acceptedQty: input.acceptedQty,
        rejectedQty: input.rejectedQty,
        note: input.note ?? null,
      },
      ipAddress: ctx.ipAddress,
      source: ctx.source ?? 'WEB',
    });

    // The next step (Quality after Production) can start on the first batch.
    if (firstClosed) await unblockDependents(tx, batch.subtask.jobId, subtaskId, actor, ctx);

    await recomputeJobStatus(tx, batch.subtask.jobId, { actor, ctx, now });
  });

  return listBatches(subtaskId);
}
