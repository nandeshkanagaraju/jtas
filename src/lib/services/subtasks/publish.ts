/**
 * Dependency initialisation at publish — build spec M4.3.
 *
 * Called from inside the job publish transaction, at the seam M3 left for it.
 */
import type { Db } from '@/lib/db/prisma';
import { initialStatusesOnPublish } from '@/lib/domain/subtask-dependencies';
import { writeAudit } from '@/lib/services/audit-service';
import { scheduleForSubtask } from '@/lib/services/notification-service';

import { openCommitmentWindow } from './commitment';
import type { Actor, RequestContext } from './types';

export interface PublishInitResult {
  pending: string[];
  blocked: string[];
}

/**
 * Sets every subtask of a freshly published job to `PENDING` or `BLOCKED`, and
 * schedules its notifications.
 *
 * A subtask whose predecessor is not complete starts `BLOCKED`: its clock is
 * not enforced until the predecessor finishes, which is what stops a Production
 * deadline from being a fake one (improvement I-02).
 */
export async function initialiseSubtasksOnPublish(
  db: Db,
  jobId: string,
  actor: Actor,
  ctx: RequestContext,
): Promise<PublishInitResult> {
  const subtasks = await db.subtask.findMany({
    where: { jobId },
    select: { id: true, dependsOnId: true, status: true, deadline: true },
  });

  const statuses = initialStatusesOnPublish(subtasks);
  const result: PublishInitResult = { pending: [], blocked: [] };

  for (const subtask of subtasks) {
    const next = statuses.get(subtask.id);
    if (!next) continue;

    if (next !== subtask.status) {
      await db.subtask.update({ where: { id: subtask.id }, data: { status: next } });

      await writeAudit(db, {
        actorId: actor.id,
        action: next === 'BLOCKED' ? 'SUBTASK_BLOCKED' : 'SUBTASK_UNBLOCKED',
        entityType: 'SUBTASK',
        entityId: subtask.id,
        before: { status: subtask.status },
        after: { status: next, reason: 'JOB_PUBLISHED' },
        ipAddress: ctx.ipAddress,
      });
    }

    // Assignment is scheduled either way. A work reminder is scheduled only
    // when a date already exists. A dateless task whose turn has arrived —
    // no predecessor, so it is not blocked — opens its 24-hour window now.
    await scheduleForSubtask(db, subtask.id);

    if (next === 'BLOCKED') result.blocked.push(subtask.id);
    else {
      result.pending.push(subtask.id);
      if (!subtask.deadline) await openCommitmentWindow(db, subtask.id);
    }
  }

  return result;
}
