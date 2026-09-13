/**
 * Creating and editing subtasks.
 *
 * Every mutation writes its audit row inside the same transaction as the change
 * (architecture rule 5).
 */
import { loadDefaultReminderLeadMinutes } from '@/lib/notifications/config';
import { prisma } from '@/lib/db/prisma';
import { notFound } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import { scheduleForSubtask } from '@/lib/services/notification-service';
import type { CreateSubtaskInput, UpdateSubtaskInput } from '@/lib/validation/subtask';

import {
  assertAssignable,
  assertDeadlineWithinJob,
  assertDependencyValid,
  parseSubtaskDeadline,
} from './invariants';
import { loadJobForSubtasks } from './job-guard';
import {
  SUBTASK_SELECT,
  subtaskSnapshot,
  type Actor,
  type RequestContext,
  type SubtaskRow,
} from './types';

/**
 * Adds one subtask to a job.
 *
 * A subtask added to a job that is *already published* is scheduled straight
 * away — otherwise it would sit silently until somebody noticed. On a draft,
 * scheduling happens at publish.
 */
export async function createSubtask(
  jobId: string,
  input: CreateSubtaskInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow> {
  const job = await loadJobForSubtasks(prisma, jobId);

  const deadline = parseSubtaskDeadline(input.deadline);
  const exceedsJobDeadline = assertDeadlineWithinJob(
    deadline,
    job.overallDeadline,
    input.deadlineOverrideReason,
  );
  const outsideDepartment = await assertAssignable(
    prisma,
    input.assigneeId,
    input.departmentId,
    input.assigneeOverrideReason,
  );

  if (input.dependsOnId) {
    await assertDependencyValid(prisma, jobId, null, input.dependsOnId);
  }

  return prisma.$transaction(async (tx) => {
    const subtask = await tx.subtask.create({
      data: {
        jobId,
        departmentId: input.departmentId,
        assigneeId: input.assigneeId,
        title: input.title,
        description: input.description ?? null,
        deadline,
        // Omitted means the operator's configured default (M9.1).
        reminderLeadMinutes: input.reminderLeadMinutes ?? (await loadDefaultReminderLeadMinutes()),
        requiresApproval: input.requiresApproval,
        dependsOnId: input.dependsOnId ?? null,
        // A draft's subtasks stay PENDING until publish decides; publish is
        // what applies the dependency rules (build spec M4.3).
        status: 'PENDING',
      },
      select: SUBTASK_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_CREATED',
      entityType: 'SUBTASK',
      entityId: subtask.id,
      after: subtaskSnapshot(subtask),
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    if (exceedsJobDeadline || outsideDepartment) {
      // The override reasons are the record of a deliberate exception; they
      // belong in the log, not only in the request that carried them.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'SUBTASK_UPDATED',
        entityType: 'SUBTASK',
        entityId: subtask.id,
        after: {
          overrides: {
            deadlineAfterJobDeadline: exceedsJobDeadline
              ? (input.deadlineOverrideReason ?? null)
              : null,
            assigneeOutsideDepartment: outsideDepartment
              ? (input.assigneeOverrideReason ?? null)
              : null,
          },
        },
        ipAddress: ctx.ipAddress,
      });
    }

    if (job.status !== 'DRAFT') {
      await scheduleForSubtask(tx, subtask.id);
      await recomputeJobStatus(tx, jobId, { actor, ctx });
    }

    return subtask;
  });
}

/**
 * MD-only metadata edit (build spec M4.2). Status changes go through
 * `changeStatus`; the deadline through `changeDeadline`.
 */
export async function updateSubtaskMeta(
  subtaskId: string,
  input: UpdateSubtaskInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow> {
  const before = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!before) throw notFound('Subtask');

  if (input.assigneeId && input.assigneeId !== before.assigneeId) {
    await assertAssignable(
      prisma,
      input.assigneeId,
      before.departmentId,
      input.assigneeOverrideReason,
    );
  }

  if (input.dependsOnId) {
    await assertDependencyValid(prisma, before.jobId, subtaskId, input.dependsOnId);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.requiresApproval !== undefined
          ? { requiresApproval: input.requiresApproval }
          : {}),
        ...(input.reminderLeadMinutes !== undefined
          ? { reminderLeadMinutes: input.reminderLeadMinutes }
          : {}),
        ...(input.dependsOnId !== undefined ? { dependsOnId: input.dependsOnId } : {}),
      },
      select: SUBTASK_SELECT,
    });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'SUBTASK_UPDATED',
      entityType: 'SUBTASK',
      entityId: subtaskId,
      before: subtaskSnapshot(before),
      after: subtaskSnapshot(updated),
      ipAddress: ctx.ipAddress,
      onBehalfOf: actor.role === 'DEPUTY_MD' ? 'MD' : null,
    });

    return updated;
  });
}
