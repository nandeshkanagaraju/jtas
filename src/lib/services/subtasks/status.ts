/**
 * Subtask status changes and the cascade they trigger — SDD section 4.4.
 *
 * The whole cascade runs in ONE transaction. That matters: if the subtask were
 * marked complete but its blocked dependents were unblocked in a second
 * transaction that failed, the shop floor would have a finished Planning task
 * and a Purchase task still waiting on it, with nothing to notice the gap.
 */
import type { ProblemSeverity, SubtaskStatus } from '@prisma/client';

import { prisma, type Db } from '@/lib/db/prisma';
import {
  DEFAULT_MIN_PROBLEM_DESCRIPTION,
  transition,
  type SubtaskAction,
  type TransitionActor,
} from '@/lib/domain/subtask-state-machine';
import { dependentsToUnblock } from '@/lib/domain/subtask-dependencies';
import { AppError, invalidTransition, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import {
  cancelPendingForSubtask,
  notifyApprovalRequired,
} from '@/lib/services/notification-service';
import { assertNoLiveProblem, createProblem } from '@/lib/services/problems/core';
import { getSettingNumber } from '@/lib/services/settings-service';
import type { SubtaskStatusChangeInput } from '@/lib/validation/subtask';

import { SUBTASK_SELECT, type Actor, type RequestContext, type SubtaskRow } from './types';

export interface StatusChangeResult {
  subtask: SubtaskRow;
  previousStatus: SubtaskStatus;
  /** Subtasks that became `PENDING` because this one completed. */
  unblocked: string[];
}

/** Loads the dependency's status in the shape the state machine expects. */
async function dependencyState(db: Db, dependsOnId: string | null) {
  if (!dependsOnId) return 'NONE' as const;

  const dependency = await db.subtask.findUnique({
    where: { id: dependsOnId },
    select: { status: true },
  });

  return dependency?.status === 'COMPLETED' ? ('COMPLETE' as const) : ('INCOMPLETE' as const);
}

/**
 * Applies an action to a subtask, then cascades.
 *
 * The decision is the pure state machine's; this function only loads what the
 * machine needs, persists what it returns, and runs the consequences.
 *
 * @throws {AppError} `NOT_FOUND`, `INVALID_TRANSITION`, `VALIDATION_ERROR`
 */
export async function changeStatus(
  subtaskId: string,
  input: SubtaskStatusChangeInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<StatusChangeResult> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!subtask) throw notFound('Subtask');

  const minProblemDescription = await getSettingNumber(
    'problem.min_description_length',
    DEFAULT_MIN_PROBLEM_DESCRIPTION,
  );

  const note = input.note?.trim() ?? '';

  // Checked before the state machine so a second report is refused with a
  // CONFLICT that names the open one, rather than an opaque transition error.
  if (input.action === 'PROBLEM') {
    await assertNoLiveProblem(prisma, subtaskId);
  }

  const result = transition(subtask.status, input.action as SubtaskAction, {
    actorRole: actor.role as TransitionActor,
    isAssignee: subtask.assigneeId === actor.id,
    requiresApproval: subtask.requiresApproval,
    dependency: await dependencyState(prisma, subtask.dependsOnId),
    problemDescriptionLength: note.length,
    problemSeverityProvided: input.severity !== undefined,
    minProblemDescriptionLength: minProblemDescription,
    reasonProvided: note.length > 0,
    rejectionNoteProvided: note.length > 0,
  });

  if (!result.ok) {
    // The two failures mean different things: the move does not exist from here
    // (409) versus it exists but a precondition is unmet (400).
    throw result.error === 'INVALID_TRANSITION'
      ? invalidTransition(result.reason, { from: subtask.status, action: input.action })
      : validationError(result.reason, { from: subtask.status, action: input.action });
  }

  const next = result.next;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subtask.update({
      where: { id: subtaskId },
      data: {
        status: next,
        ...(next === 'IN_PROGRESS' && !subtask.startedAt ? { startedAt: now } : {}),
        ...(next === 'COMPLETED' ? { completedAt: now, completionNote: note || null } : {}),
        // Re-opening clears the completion stamp, so a rejected subtask does
        // not read as finished in the timeline.
        ...(subtask.status === 'AWAITING_APPROVAL' && next === 'IN_PROGRESS'
          ? { completedAt: null }
          : {}),
      },
      select: SUBTASK_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_STATUS_CHANGED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: { status: subtask.status },
      after: { status: next, action: input.action, note: note || null },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    let unblocked: string[] = [];

    if (next === 'COMPLETED' || next === 'CANCELLED') {
      // Improvement I-05: never chase somebody for work that is already done
      // or called off.
      await cancelPendingForSubtask(tx, subtaskId);
    }

    if (next === 'COMPLETED') {
      unblocked = await unblockDependents(tx, subtask.jobId, subtaskId, actor, ctx);
    }

    if (next === 'PROBLEM') {
      // One path for raising, shared with `raiseProblem`: the row, its audit
      // entry and the notification to the MD all land inside this transaction.
      await createProblem(tx, {
        subtaskId,
        raisedById: actor.id,
        description: note,
        severity: (input.severity ?? 'MEDIUM') as ProblemSeverity,
        ipAddress: ctx.ipAddress,
      });
    }

    if (next === 'AWAITING_APPROVAL') {
      await notifyApprovalRequired(tx, subtaskId);
    }

    if (subtask.status === 'PROBLEM' && next === 'IN_PROGRESS') {
      // FR-43: resolving through the subtask closes the open problem too, so
      // the MD inbox does not keep showing something already dealt with.
      await tx.problem.updateMany({
        where: { subtaskId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        data: {
          status: 'RESOLVED',
          resolvedById: actor.id,
          resolvedAt: now,
          mdActionNote: note || null,
        },
      });
    }

    await recomputeJobStatus(tx, subtask.jobId, { actor, ctx, now });

    return { subtask: updated, previousStatus: subtask.status, unblocked };
  });
}

/**
 * Flips every `BLOCKED` dependent of `completedId` to `PENDING`.
 *
 * Each flip goes through the state machine as a `SYSTEM` actor rather than
 * being written directly, so the one place that decides what `BLOCKED` means
 * stays the one place — and an unexpected status is skipped rather than
 * trampled.
 */
async function unblockDependents(
  tx: Db,
  jobId: string,
  completedId: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<string[]> {
  const siblings = await tx.subtask.findMany({
    where: { jobId },
    select: { id: true, dependsOnId: true, status: true },
  });

  const candidates = dependentsToUnblock(siblings, completedId);
  const unblocked: string[] = [];

  for (const id of candidates) {
    const check = transition('BLOCKED', 'UNBLOCK', {
      actorRole: 'SYSTEM',
      isAssignee: false,
      requiresApproval: false,
      dependency: 'COMPLETE',
    });
    if (!check.ok) continue;

    await tx.subtask.update({ where: { id }, data: { status: check.next } });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_UNBLOCKED',
      entityType: 'SUBTASK',
      entityId: id,
      before: { status: 'BLOCKED' },
      after: { status: check.next, unblockedBy: completedId },
      ipAddress: ctx.ipAddress,
    });

    unblocked.push(id);
  }

  return unblocked;
}

/** Re-exported so route handlers can map a machine failure without importing it. */
export { AppError };
