/**
 * The MD's side of the problem lifecycle — FR-42, FR-43.
 *
 * Improvement I-05 is the reason this module matters: once a problem is on
 * record the member stops being nagged and the pressure moves to the decision
 * maker. That only works if the decision is easy to make and impossible to
 * make vaguely — hence a mandatory action note on every path, and five named
 * actions rather than a free-text box.
 */
import { prisma } from '@/lib/db/prisma';
import { conflict, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyProblemResolved } from '@/lib/services/notification-service';
import {
  changeDeadline,
  changeStatus,
  reassignSubtask,
  type Actor,
  type RequestContext,
} from '@/lib/services/subtasks';
import type {
  RejectProblemInput,
  ResolutionAction,
  ResolveProblemInput,
} from '@/lib/validation/problem';

import { LIVE_PROBLEM_STATUSES } from './core';
import { getProblem, loadProblemForWrite, type ProblemSummary } from './queries';
import { closeProblem, escalate, resumeSubtask } from './resolutions';

/** A problem can only be acted on while it is still live. */
function assertLive(problem: { id: string; status: string }): void {
  if (!(LIVE_PROBLEM_STATUSES as readonly string[]).includes(problem.status)) {
    throw conflict(`This problem has already been ${problem.status.toLowerCase()}.`, {
      reason: 'PROBLEM_ALREADY_CLOSED',
      status: problem.status,
    });
  }
}

/**
 * Marks a problem as read (FR-42).
 *
 * Deliberately separate from resolving: the MD often sees a problem long before
 * they can decide what to do, and the member deserves to know it has been seen.
 * It does not stop the ageing clock — reading a problem is not solving it, and
 * `isStale` treats an acknowledged problem exactly like an open one.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`
 */
export async function acknowledgeProblem(
  problemId: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<ProblemSummary> {
  const problem = await loadProblemForWrite(problemId);
  assertLive(problem);

  if (problem.status === 'ACKNOWLEDGED') {
    throw conflict('This problem has already been acknowledged.', {
      reason: 'ALREADY_ACKNOWLEDGED',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.problem.update({
      where: { id: problemId },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'PROBLEM_ACKNOWLEDGED',
      entityType: 'PROBLEM',
      entityId: problemId,
      before: { status: problem.status },
      after: { status: 'ACKNOWLEDGED' },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });
  });

  return getProblem(problemId);
}

export interface ResolveResult {
  problem: ProblemSummary;
  action: ResolutionAction;
  /** Set when ESCALATE_TO_DEPARTMENT created one. */
  escalatedSubtaskId: string | null;
}

/**
 * Closes a problem with a decision (FR-42).
 *
 * Each action delegates to the subtask service rather than writing the subtask
 * itself, so an extension granted here leaves exactly the same trail as one
 * granted anywhere else — a `DeadlineChange` row, a reset escalation clock, a
 * rescheduled reminder. There is no second, weaker path to the same effect.
 *
 * The subtask work runs before the problem is closed: if moving a deadline
 * fails, the problem must stay open rather than read as decided.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`
 */
export async function resolveProblem(
  problemId: string,
  input: ResolveProblemInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<ResolveResult> {
  const problem = await loadProblemForWrite(problemId);
  assertLive(problem);

  const subtaskId = problem.subtaskId;
  let escalatedSubtaskId: string | null = null;

  switch (input.action) {
    case 'RESUME':
      // The state machine's PROBLEM -> IN_PROGRESS, which also closes the
      // problem row; the explicit close below is then a no-op for it.
      await resumeSubtask(subtaskId, input.mdActionNote, actor, ctx);
      break;

    case 'EXTEND': {
      await changeDeadline(
        subtaskId,
        {
          newDeadline: input.newDeadline!,
          reason: `Problem resolved with more time: ${input.mdActionNote}`,
          deadlineOverrideReason: input.deadlineOverrideReason,
        },
        actor,
        ctx,
      );
      await resumeSubtask(subtaskId, input.mdActionNote, actor, ctx);
      break;
    }

    case 'REASSIGN': {
      await reassignSubtask(
        subtaskId,
        {
          assigneeId: input.assigneeId!,
          reason: `Problem resolved by reassigning: ${input.mdActionNote}`,
          assigneeOverrideReason: input.assigneeOverrideReason,
        },
        actor,
        ctx,
      );
      await resumeSubtask(subtaskId, input.mdActionNote, actor, ctx);
      break;
    }

    case 'CANCEL_SUBTASK':
      // Cancelling leaves nothing to resume; the problem is closed below.
      await changeStatus(
        subtaskId,
        { action: 'CANCEL', note: `Problem resolved by cancelling: ${input.mdActionNote}` },
        actor,
        ctx,
      );
      break;

    case 'ESCALATE_TO_DEPARTMENT':
      escalatedSubtaskId = await escalate(problem.subtask.job.id, subtaskId, input, actor, ctx);
      await resumeSubtask(subtaskId, input.mdActionNote, actor, ctx);
      break;
  }

  await closeProblem(problemId, input, actor, ctx);

  return { problem: await getProblem(problemId), action: input.action, escalatedSubtaskId };
}

/**
 * Rejects a problem: the MD does not accept it as one (FR-42).
 *
 * The subtask returns to `IN_PROGRESS` — the member still has the work — and
 * the note is mandatory because a bare rejection is how a member learns to stop
 * reporting things.
 *
 * @throws {AppError} `NOT_FOUND`, `CONFLICT`
 */
export async function rejectProblem(
  problemId: string,
  input: RejectProblemInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<ProblemSummary> {
  const problem = await loadProblemForWrite(problemId);
  assertLive(problem);

  await resumeSubtask(problem.subtaskId, input.note, actor, ctx);

  await prisma.$transaction(async (tx) => {
    await tx.problem.update({
      where: { id: problemId },
      data: {
        status: 'REJECTED',
        resolvedById: actor.id,
        resolvedAt: new Date(),
        mdActionNote: input.note,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'PROBLEM_REJECTED',
      entityType: 'PROBLEM',
      entityId: problemId,
      before: { status: problem.status },
      after: { status: 'REJECTED', note: input.note },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    await notifyProblemResolved(tx, {
      problemId,
      subtaskId: problem.subtaskId,
      assigneeId: problem.subtask.assigneeId,
      action: 'REJECTED',
      mdActionNote: input.note,
    });
  });

  return getProblem(problemId);
}

/**
 * Raises a problem — the member's entry point (build spec M6.1).
 *
 * A thin wrapper over the state machine: the transition owns the guards
 * (description length from settings, severity present, correct source status)
 * and this adds only the one-live-problem rule and the problem row itself.
 *
 * @throws {AppError} `CONFLICT`, `VALIDATION_ERROR`, `INVALID_TRANSITION`
 */
export async function raiseProblem(
  subtaskId: string,
  input: { description: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER' },
  actor: Actor,
  ctx: RequestContext,
): Promise<ProblemSummary> {
  await changeStatus(
    subtaskId,
    { action: 'PROBLEM', note: input.description, severity: input.severity },
    actor,
    ctx,
  );

  const created = await prisma.problem.findFirst({
    where: { subtaskId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!created) {
    // Unreachable: `changeStatus` creates the row in the same transaction as
    // the status change, so a missing row means that transaction did not commit.
    throw validationError('The problem could not be recorded. Try again.');
  }

  return getProblem(created.id);
}
