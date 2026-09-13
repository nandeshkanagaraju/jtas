/**
 * Whether a job is still open to new subtasks.
 *
 * Shared by the single and bulk create paths so the rule cannot drift between
 * them — a cancelled or completed job takes no more work.
 */
import type { Db } from '@/lib/db/prisma';
import { notFound, validationError } from '@/lib/errors';

/** Statuses in which a job still accepts new subtasks. */
const ACCEPTS_SUBTASKS = ['DRAFT', 'IN_PROGRESS', 'AT_RISK', 'DELAYED', 'ON_HOLD'] as const;

export async function loadJobForSubtasks(db: Db, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobCode: true, status: true, overallDeadline: true },
  });

  if (!job) throw notFound('Job');

  if (!(ACCEPTS_SUBTASKS as readonly string[]).includes(job.status)) {
    throw validationError(
      `${job.jobCode} is ${job.status.toLowerCase().replace('_', ' ')} and no longer takes new subtasks.`,
      { reason: 'JOB_CLOSED' },
    );
  }

  return job;
}
