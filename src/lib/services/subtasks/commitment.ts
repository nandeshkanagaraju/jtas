/**
 * Sequential commitment — PDD section 14.2.
 *
 * A date exists when the department commits it, or when the MD sets one.
 * Opening the window and committing the date both queue their mail in the
 * same transaction as the change.
 */
import { commitmentDueAt } from '@/lib/domain/commitment';
import type { Db } from '@/lib/db/prisma';
import { prisma } from '@/lib/db/prisma';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import { notifyCommitmentMade, rescheduleForSubtask } from '@/lib/services/notification-service';
import { enqueueCommitmentWindow } from '@/lib/notifications/notification-service';
import type { CommitDeadlineInput } from '@/lib/validation/subtask';

import { assertDeadlineWithinJob, parseSubtaskDeadline } from './invariants';
import { SUBTASK_SELECT, type Actor, type RequestContext, type SubtaskRow } from './types';

const CLOSED = ['COMPLETED', 'CANCELLED'] as const;

/**
 * Starts the 24-hour clock on a task whose turn has arrived and that has no
 * date yet. A task that already has a date, or whose window is already open,
 * is left alone.
 */
export async function openCommitmentWindow(
  db: Db,
  subtaskId: string,
  now: Date = new Date(),
): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      assigneeId: true,
      deadline: true,
      commitmentDueAt: true,
      status: true,
    },
  });
  if (!subtask || subtask.deadline || subtask.commitmentDueAt) return;
  if (
    subtask.status === 'BLOCKED' ||
    subtask.status === 'COMPLETED' ||
    subtask.status === 'CANCELLED'
  ) {
    return;
  }

  const due = commitmentDueAt(now);
  await db.subtask.update({
    where: { id: subtaskId },
    data: { commitmentDueAt: due },
  });
  await enqueueCommitmentWindow(db, subtaskId, subtask.assigneeId, due, now);
}

/**
 * The assignee commits a finish date. Once written, they cannot move it;
 * more time is an extension request, which the MD decides.
 *
 * @throws {AppError} `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_ERROR`
 */
export async function commitDeadline(
  subtaskId: string,
  input: CommitDeadlineInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!subtask) throw notFound('Subtask');

  if (actor.id !== subtask.assigneeId) {
    throw forbidden('Only the person who holds this task can commit its date.');
  }

  if ((CLOSED as readonly string[]).includes(subtask.status)) {
    throw validationError('This task is already closed.', { reason: 'SUBTASK_CLOSED' });
  }

  if (subtask.status === 'BLOCKED' || !subtask.commitmentDueAt) {
    throw validationError(
      'This task is not ready for a date yet. It commits when its turn arrives.',
      {
        reason: 'COMMITMENT_NOT_OPEN',
      },
    );
  }

  if (subtask.deadline) {
    throw validationError(
      'This date is already committed. You cannot move it. Ask the MD for more time.',
      { reason: 'ALREADY_COMMITTED' },
    );
  }

  const deadline = parseSubtaskDeadline(input.deadline);
  assertDeadlineWithinJob(
    deadline,
    subtask.job.overallDeadline,
    input.deadlineOverrideReason,
    'deadline',
  );

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subtask.update({
      where: { id: subtaskId },
      data: {
        deadline,
        deadlineOrigin: 'DEPARTMENT',
        commitmentEscalationCount: 0,
        commitmentLastEscalatedAt: null,
        escalationCount: 0,
        lastEscalatedAt: null,
      },
      select: SUBTASK_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_DEADLINE_CHANGED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { deadline: null, deadlineOrigin: null },
      after: {
        deadline: deadline.toISOString(),
        deadlineOrigin: 'DEPARTMENT',
        reason: 'Committed by the department',
      },
      ipAddress: ctx.ipAddress,
    });

    await rescheduleForSubtask(tx, subtaskId);
    await notifyCommitmentMade(tx, subtaskId);
    await recomputeJobStatus(tx, subtask.jobId, { actor, ctx });

    return updated;
  });
}
