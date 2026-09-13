/**
 * Persistence wrapper around the pure status ladder.
 *
 * The decision itself lives in `@/lib/domain/job-status`; this file only loads
 * the rows it needs, writes the result, and records the change. Keeping the two
 * apart is what lets the ladder be tested exhaustively without fixtures.
 */
import type { JobStatus } from '@prisma/client';

import type { Db } from '@/lib/db/prisma';
import { deriveJobStatus } from '@/lib/domain/job-status';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyJobCompleted } from '@/lib/services/notification-service';

import { toSubtaskSnapshots, type Actor, type RequestContext } from './types';

export interface RecomputeResult {
  jobId: string;
  previous: JobStatus;
  current: JobStatus;
  changed: boolean;
}

/**
 * Recomputes and persists a job's derived status.
 *
 * Call after any change to the job or to any of its subtasks. Safe to call when
 * nothing has changed: the write and the audit row only happen when the value
 * actually moves, so the log stays a record of events rather than of polling.
 *
 * @param db Transaction client, so the status lands with the change that caused it.
 */
export async function recomputeJobStatus(
  db: Db,
  jobId: string,
  options: { actor?: Actor; ctx?: RequestContext; now?: Date } = {},
): Promise<RecomputeResult | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      overallDeadline: true,
      completedAt: true,
      subtasks: { select: { status: true, deadline: true } },
    },
  });

  if (!job) return null;

  const now = options.now ?? new Date();

  const next = deriveJobStatus({
    currentStatus: job.status,
    overallDeadline: job.overallDeadline,
    subtasks: toSubtaskSnapshots(job.subtasks),
    now,
  });

  if (next === job.status) {
    return { jobId, previous: job.status, current: next, changed: false };
  }

  await db.job.update({
    where: { id: jobId },
    data: {
      status: next,
      // Stamped the first time a job completes and never cleared afterwards —
      // it is the delivery date, and reopening would not change when the work
      // was finished.
      ...(next === 'COMPLETED' && !job.completedAt ? { completedAt: now } : {}),
    },
  });

  await writeAudit(db, {
    actorId: options.actor?.id ?? null,
    action: 'JOB_STATUS_RECOMPUTED',
    entityType: 'JOB',
    entityId: jobId,
    before: { status: job.status },
    after: { status: next },
    ipAddress: options.ctx?.ipAddress ?? null,
  });

  // Told once, the first time a job closes: the dedupe key is the job id, so a
  // later recompute cannot mail it again.
  if (next === 'COMPLETED') {
    await notifyJobCompleted(db, jobId);
  }

  return { jobId, previous: job.status, current: next, changed: true };
}
