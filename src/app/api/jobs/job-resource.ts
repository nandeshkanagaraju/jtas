/**
 * Builds the `JobResource` the policy needs.
 *
 * `can(user, 'job:view', …)` decides a member's access from the set of people
 * holding a subtask on the job, so that list has to be loaded before the
 * decision — the policy stays pure and issues no queries of its own.
 */
import { prisma } from '@/lib/db/prisma';
import type { JobResource } from '@/lib/auth/policy';

export async function jobResource(jobId: string, createdById: string): Promise<JobResource> {
  const assignees = await prisma.subtask.findMany({
    where: { jobId },
    select: { assigneeId: true },
    distinct: ['assigneeId'],
  });

  return {
    id: jobId,
    createdById,
    participantIds: assignees.map((row) => row.assigneeId),
  };
}
