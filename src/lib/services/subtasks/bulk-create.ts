/**
 * Bulk subtask creation — the job wizard's step 2, and the path a template takes.
 *
 * Separate from the single create because the batch has a property the single
 * one does not: dependencies *inside* the batch, expressed with `dependsOnKey`
 * before any row has an id. Resolving those is what the second pass below does,
 * and it is the reason the whole thing has to be one transaction.
 */
import { loadDefaultReminderLeadMinutes } from '@/lib/notifications/config';
import { prisma } from '@/lib/db/prisma';
import { validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { recomputeJobStatus } from '@/lib/services/jobs';
import { scheduleForSubtask } from '@/lib/services/notification-service';
import type { BulkCreateSubtasksInput } from '@/lib/validation/subtask';

import { assertAssignable, assertDeadlineWithinJob, parseSubtaskDeadline } from './invariants';
import { loadJobForSubtasks } from './job-guard';
import {
  SUBTASK_SELECT,
  subtaskSnapshot,
  type Actor,
  type RequestContext,
  type SubtaskRow,
} from './types';

/**
 * Creates a whole set of subtasks at once — the job wizard's step 2, and the
 * path a template takes.
 *
 * Dependencies inside the batch are expressed with `dependsOnKey`, a
 * client-side reference to another row that has no id yet. They are resolved to
 * real foreign keys after the inserts, inside the same transaction, so either
 * the whole chain lands or none of it does.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export async function bulkCreateSubtasks(
  jobId: string,
  input: BulkCreateSubtasksInput,
  actor: Actor,
  ctx: RequestContext,
): Promise<SubtaskRow[]> {
  const job = await loadJobForSubtasks(prisma, jobId);

  // Validate everything before writing anything: a half-built set of subtasks
  // is worse than none.
  const prepared = await Promise.all(
    input.subtasks.map(async (draft, index) => {
      const deadline = draft.deadline
        ? parseSubtaskDeadline(draft.deadline, {
            field: `subtasks.${index}.deadline`,
          })
        : null;

      if (deadline) {
        assertDeadlineWithinJob(
          deadline,
          job.overallDeadline,
          draft.deadlineOverrideReason,
          `subtasks.${index}.deadline`,
        );
      }
      await assertAssignable(
        prisma,
        draft.assigneeId,
        draft.departmentId,
        draft.assigneeOverrideReason,
        `subtasks.${index}.assigneeId`,
      );

      return { draft, deadline, index };
    }),
  );

  assertBatchDependenciesAcyclic(input);

  /*
   * Read once for the batch, not per subtask. A draft that names its own lead
   * time keeps it; one that does not gets whatever the operator has configured
   * — which is what makes the setting on /settings mean anything.
   */
  const defaultLead = await loadDefaultReminderLeadMinutes();

  return prisma.$transaction(async (tx) => {
    const created: SubtaskRow[] = [];
    /** Maps each draft's client-side key to the id it was given. */
    const idByKey = new Map<string, string>();

    for (const { draft, deadline } of prepared) {
      const subtask = await tx.subtask.create({
        data: {
          jobId,
          departmentId: draft.departmentId,
          assigneeId: draft.assigneeId,
          title: draft.title,
          description: draft.description ?? null,
          deadline,
          deadlineOrigin: deadline ? 'MD' : null,
          reminderLeadMinutes: draft.reminderLeadMinutes ?? defaultLead,
          requiresApproval: draft.requiresApproval,
          // Real foreign keys only; in-batch references are linked below.
          dependsOnId: draft.dependsOnId ?? null,
          status: 'PENDING',
        },
        select: SUBTASK_SELECT,
      });

      if (draft.key) idByKey.set(draft.key, subtask.id);
      created.push(subtask);

      await writeAudit(tx, {
        actorId: actor.id,
        action: 'SUBTASK_CREATED',
        entityType: 'SUBTASK',
        entityId: subtask.id,
        after: subtaskSnapshot(subtask),
        ipAddress: ctx.ipAddress,
      });
    }

    // Second pass: now that every row has an id, resolve the in-batch links.
    for (const [position, { draft }] of prepared.entries()) {
      if (!draft.dependsOnKey) continue;

      const dependsOnId = idByKey.get(draft.dependsOnKey);
      if (!dependsOnId) {
        throw validationError(`"${draft.title}" depends on a subtask that is not in this list.`, {
          fields: { [`subtasks.${position}.dependsOnKey`]: ['Choose an earlier subtask.'] },
        });
      }

      const updated = await tx.subtask.update({
        where: { id: created[position].id },
        data: { dependsOnId },
        select: SUBTASK_SELECT,
      });
      created[position] = updated;
    }

    if (job.status !== 'DRAFT') {
      for (const subtask of created) await scheduleForSubtask(tx, subtask.id);
      await recomputeJobStatus(tx, jobId, { actor, ctx });
    }

    return created;
  });
}

/**
 * Rejects a batch whose in-batch `dependsOnKey` references form a loop.
 *
 * Checked before any insert, because the rows do not exist yet and the
 * database-backed cycle check cannot see them.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
function assertBatchDependenciesAcyclic(input: BulkCreateSubtasksInput): void {
  const parentOf = new Map<string, string>();

  for (const draft of input.subtasks) {
    if (draft.key && draft.dependsOnKey) parentOf.set(draft.key, draft.dependsOnKey);
  }

  for (const [start] of parentOf) {
    const seen = new Set<string>([start]);
    let current = parentOf.get(start);

    while (current) {
      if (seen.has(current)) {
        throw validationError(
          'These subtasks would wait for each other in a loop. Check the "depends on" column.',
          { reason: 'DEPENDENCY_CYCLE' },
        );
      }
      seen.add(current);
      current = parentOf.get(current);
    }
  }
}
