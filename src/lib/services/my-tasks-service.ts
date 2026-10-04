/**
 * The member's working set — FR-30, build spec M5.1.
 *
 * One query. The screen has to be readable in seconds on a phone over 4G, so
 * everything it needs — the job header, the department, the dependency's state
 * and whether a problem is open — is loaded in a single round trip and grouped
 * in memory by the pure bucketer.
 */
import type { SubtaskStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import {
  groupTasks,
  hoursRemaining,
  summarise,
  type BucketName,
  type TaskSummary,
} from '@/lib/domain/task-buckets';

/** What a card on My Tasks shows (build spec M5.1). */
export interface MyTask {
  id: string;
  jobId: string;
  jobCode: string;
  jobTitle: string;
  partNumber: string | null;
  department: { id: string; name: string; code: string };
  title: string;
  deadline: Date | null;
  commitmentDueAt: Date | null;
  status: SubtaskStatus;
  /** Negative once the deadline has passed. */
  hoursRemaining: number;
  requiresApproval: boolean;
  /** Why a blocked task is blocked, in the words the member needs. */
  dependency: {
    id: string;
    title: string;
    departmentName: string;
    status: SubtaskStatus;
    deadline: Date | null;
  } | null;
  hasOpenProblem: boolean;
  completedAt: Date | null;
}

export interface MyTasksResult {
  buckets: Record<BucketName, MyTask[]>;
  summary: TaskSummary;
  /** Server clock, so the client's countdown cannot drift from the buckets. */
  now: Date;
}

/**
 * Everything assigned to `userId`, bucketed.
 *
 * Cancelled subtasks and those on jobs that are cancelled or on hold are
 * excluded in the query rather than filtered afterwards: a member should not be
 * asked to do work that has been called off, and not loading it is cheaper than
 * discarding it.
 */
export async function getMyTasks(userId: string, now: Date = new Date()): Promise<MyTasksResult> {
  const rows = await prisma.subtask.findMany({
    where: {
      assigneeId: userId,
      status: { not: 'CANCELLED' },
      job: { status: { notIn: ['CANCELLED', 'ON_HOLD', 'DRAFT'] } },
    },
    select: {
      id: true,
      jobId: true,
      title: true,
      deadline: true,
      commitmentDueAt: true,
      status: true,
      completedAt: true,
      requiresApproval: true,
      department: { select: { id: true, name: true, code: true } },
      job: { select: { jobCode: true, title: true, partNumber: true } },
      dependsOn: {
        select: {
          id: true,
          title: true,
          status: true,
          deadline: true,
          department: { select: { name: true } },
        },
      },
      // Filtered in the same query, so "does this have an open problem?" costs
      // nothing extra and the screen never issues a second round trip.
      problems: {
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  const tasks: MyTask[] = rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    jobCode: row.job.jobCode,
    jobTitle: row.job.title,
    partNumber: row.job.partNumber,
    department: row.department,
    title: row.title,
    deadline: row.deadline,
    commitmentDueAt: row.commitmentDueAt,
    status: row.status,
    hoursRemaining: hoursRemaining(row, now),
    requiresApproval: row.requiresApproval,
    dependency: row.dependsOn
      ? {
          id: row.dependsOn.id,
          title: row.dependsOn.title,
          departmentName: row.dependsOn.department.name,
          status: row.dependsOn.status,
          deadline: row.dependsOn.deadline,
        }
      : null,
    hasOpenProblem: row.problems.length > 0,
    completedAt: row.completedAt,
  }));

  const buckets = groupTasks(tasks, now);

  return { buckets, summary: summarise(buckets), now };
}
