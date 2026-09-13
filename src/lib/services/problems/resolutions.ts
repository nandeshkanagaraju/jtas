/**
 * The mechanics behind each resolution action.
 *
 * Split from the lifecycle so that file reads as the decision flow — what
 * happens when an MD closes a problem — while this one holds how each outcome
 * is actually carried out. Every one delegates to the subtask service rather
 * than writing the subtask itself, so a decision made here leaves exactly the
 * same trail as the same decision made anywhere else.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyProblemResolved } from '@/lib/services/notification-service';
import {
  changeStatus,
  createSubtask,
  updateSubtaskMeta,
  type Actor,
  type RequestContext,
} from '@/lib/services/subtasks';
import type { ResolveProblemInput } from '@/lib/validation/problem';

import { loadProblemForWrite } from './queries';

/**
 * Returns the subtask to `IN_PROGRESS` through the state machine (FR-43).
 *
 * Tolerates a subtask that has already left `PROBLEM` — a member who resolved
 * their own blockage through the task screen a moment earlier should not make
 * the MD's decision fail.
 */
export async function resumeSubtask(
  subtaskId: string,
  note: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<void> {
  const subtask = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: { status: true },
  });
  if (subtask?.status !== 'PROBLEM') return;

  await changeStatus(subtaskId, { action: 'RESOLVE_PROBLEM', note }, actor, ctx);
}

/**
 * Creates the subtask another department has to do first (FR-42, "escalate to
 * another department").
 *
 * When `blockOriginal` is set the stuck subtask is pointed at the new one. It
 * is not forced into `BLOCKED` — that transition only exists from `PENDING` —
 * but it does not need to be: the state machine refuses `COMPLETE` while a
 * dependency is unfinished, so the original genuinely cannot be closed until
 * the escalated work is done.
 */
export async function escalate(
  jobId: string,
  originalSubtaskId: string,
  input: ResolveProblemInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<string> {
  const escalation = input.escalation!;

  const created = await createSubtask(
    jobId,
    {
      departmentId: escalation.departmentId,
      assigneeId: escalation.assigneeId,
      title: escalation.title,
      description: `Raised from a problem on another task: ${input.mdActionNote}`,
      deadline: escalation.deadline,
      reminderLeadMinutes: 360,
      requiresApproval: false,
      assigneeOverrideReason: escalation.assigneeOverrideReason,
    },
    actor,
    ctx,
  );

  if (escalation.blockOriginal) {
    await updateSubtaskMeta(originalSubtaskId, { dependsOnId: created.id }, actor, ctx);
  }

  return created.id;
}

/** Writes the decision onto the problem row and tells the member. */
export async function closeProblem(
  problemId: string,
  input: ResolveProblemInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<void> {
  const before = await loadProblemForWrite(problemId);

  await prisma.$transaction(async (tx) => {
    await tx.problem.update({
      where: { id: problemId },
      data: {
        status: 'RESOLVED',
        resolvedById: actor.id,
        resolvedAt: new Date(),
        // Prefixed with the action so the record answers "what did you do?"
        // and not merely "what did you say?".
        mdActionNote: `[${input.action}] ${input.mdActionNote}`,
      },
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'PROBLEM_RESOLVED',
      entityType: 'PROBLEM',
      entityId: problemId,
      before: { status: before.status },
      after: {
        status: 'RESOLVED',
        resolutionAction: input.action,
        mdActionNote: input.mdActionNote,
      },
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    await notifyProblemResolved(tx, {
      problemId,
      subtaskId: before.subtaskId,
      assigneeId: before.subtask.assigneeId,
      action: input.action,
      mdActionNote: input.mdActionNote,
    });
  });
}
