/**
 * Deadline changes and reassignment — SDD section 4.5, FR-24.
 *
 * Both are MD/Deputy-only, both require a reason, and both reschedule
 * notifications inside the same transaction as the change.
 */
import { prisma } from '@/lib/db/prisma';
import { notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import {
  notifyDeadlineChange,
  notifyReassignment,
  rescheduleForSubtask,
} from '@/lib/services/notification-service';
import type { ChangeDeadlineInput, ReassignInput } from '@/lib/validation/subtask';

import { assertAssignable, assertDeadlineWithinJob, parseSubtaskDeadline } from './invariants';
import {
  SUBTASK_SELECT,
  subtaskSnapshot,
  type Actor,
  type RequestContext,
  type SubtaskRow,
} from './types';

/** A closed subtask's deadline is history; moving it would rewrite the record. */
const CLOSED = ['COMPLETED', 'CANCELLED'] as const;

/**
 * Changes a subtask deadline (SDD section 4.5).
 *
 * Writes a `DeadlineChange` row, resets `escalationCount` to zero, and
 * reschedules. The reset matters: a subtask that has already fired two of its
 * three overdue escalations gets a genuinely fresh deadline, not one that
 * escalates again after a single missed hour.
 *
 * @throws {AppError} `NOT_FOUND`, `VALIDATION_ERROR`
 */
export async function changeDeadline(
  subtaskId: string,
  input: ChangeDeadlineInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!subtask) throw notFound('Subtask');

  if ((CLOSED as readonly string[]).includes(subtask.status)) {
    throw validationError(
      `This subtask is already ${subtask.status.toLowerCase()}; its deadline cannot be changed.`,
      { reason: 'SUBTASK_CLOSED' },
    );
  }

  const newDeadline = parseSubtaskDeadline(input.newDeadline, { field: 'newDeadline' });

  if (newDeadline.getTime() === subtask.deadline.getTime()) {
    throw validationError('That is the deadline it already has.', {
      fields: { newDeadline: ['Choose a different date and time.'] },
    });
  }

  assertDeadlineWithinJob(
    newDeadline,
    subtask.job.overallDeadline,
    input.deadlineOverrideReason,
    'newDeadline',
  );

  const oldDeadline = subtask.deadline;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subtask.update({
      where: { id: subtaskId },
      data: {
        deadline: newDeadline,
        // SDD 4.5: a new deadline starts a new escalation clock.
        escalationCount: 0,
        lastEscalatedAt: null,
      },
      select: SUBTASK_SELECT,
    });

    await tx.deadlineChange.create({
      data: {
        subtaskId,
        oldDeadline,
        newDeadline,
        reason: input.reason,
        changedById: actor.id,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_DEADLINE_CHANGED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { deadline: oldDeadline.toISOString(), escalationCount: subtask.escalationCount },
      after: {
        deadline: newDeadline.toISOString(),
        escalationCount: 0,
        reason: input.reason,
        overrodeJobDeadline: input.deadlineOverrideReason ?? null,
      },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    // The dedupe key carries the deadline epoch, so the old reminder can never
    // be resurrected and a new one is created naturally (SDD 5.1).
    await rescheduleForSubtask(tx, subtaskId);
    await notifyDeadlineChange(tx, subtaskId);

    // A moved deadline can take the job out of DELAYED, or put it there.
    await recomputeJobStatus(tx, subtask.jobId, { actor, ctx });

    return updated;
  });
}

/**
 * Reassigns a subtask (FR-24). Both the old and the new assignee are notified.
 *
 * @throws {AppError} `NOT_FOUND`, `VALIDATION_ERROR`
 */
export async function reassignSubtask(
  subtaskId: string,
  input: ReassignInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!subtask) throw notFound('Subtask');

  if ((CLOSED as readonly string[]).includes(subtask.status)) {
    throw validationError(
      `This subtask is already ${subtask.status.toLowerCase()} and does not need an owner.`,
      { reason: 'SUBTASK_CLOSED' },
    );
  }

  if (input.assigneeId === subtask.assigneeId) {
    throw validationError(`${subtask.assignee.name} already holds this subtask.`, {
      fields: { assigneeId: ['Choose somebody else.'] },
    });
  }

  await assertAssignable(
    prisma,
    input.assigneeId,
    subtask.departmentId,
    input.assigneeOverrideReason,
  );

  const previousAssigneeId = subtask.assigneeId;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subtask.update({
      where: { id: subtaskId },
      data: { assigneeId: input.assigneeId },
      select: SUBTASK_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_REASSIGNED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { assigneeId: previousAssigneeId, assigneeName: subtask.assignee.name },
      after: {
        assigneeId: updated.assigneeId,
        assigneeName: updated.assignee.name,
        reason: input.reason,
        overrodeDepartment: input.assigneeOverrideReason ?? null,
      },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    // The pending reminder is addressed to the old assignee; it has to be
    // reissued to the new one.
    await rescheduleForSubtask(tx, subtaskId);
    await notifyReassignment(tx, subtaskId, previousAssigneeId, input.assigneeId);

    return updated;
  });
}

export { subtaskSnapshot };
