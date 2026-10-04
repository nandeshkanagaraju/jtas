/**
 * "Needs your attention" and the at-risk job table (build spec M8.3).
 *
 * The two lists above the fold are the point of the dashboard: the problems
 * waiting on a decision and the deadlines already missed. Both are capped —
 * a screen showing four hundred overdue subtasks is a screen nobody reads.
 */
import { prisma } from '@/lib/db/prisma';
import { overdueHours, round1 } from '@/lib/domain/metrics';

import type { AttentionProblem, AttentionSubtask, JobAtRisk } from './types';

/** How many rows each list shows before it becomes a list nobody reads. */
export const ATTENTION_LIMIT = 8;
export const AT_RISK_LIMIT = 15;

const OPEN_PROBLEM_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;
const OVERDUE_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL'] as const;
const DORMANT_JOB_STATUSES = ['ON_HOLD', 'CANCELLED', 'DRAFT'] as const;

/** BLOCKER first, then oldest — severity outranks age, but age breaks ties. */
const SEVERITY_ORDER = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];

interface BlockingRow {
  jobId: string;
  departmentName: string;
  subtaskTitle: string;
  overdue_subtasks: bigint;
  open_problems: bigint;
}

/** The two lists the MD must act on today. */
export async function needsAttention(now: Date = new Date()): Promise<{
  problems: AttentionProblem[];
  overdueSubtasks: AttentionSubtask[];
}> {
  const [problems, overdue] = await Promise.all([
    prisma.problem.findMany({
      where: { status: { in: [...OPEN_PROBLEM_STATUSES] } },
      // Over-fetched a little, because severity ordering is done below: the
      // enum's declaration order is LOW..BLOCKER, which is backwards for us.
      take: ATTENTION_LIMIT * 4,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        severity: true,
        status: true,
        description: true,
        createdAt: true,
        subtask: {
          select: {
            id: true,
            title: true,
            job: { select: { id: true, jobCode: true } },
            department: { select: { name: true } },
            assignee: { select: { name: true } },
          },
        },
      },
    }),

    prisma.subtask.findMany({
      where: {
        status: { in: [...OVERDUE_STATUSES] },
        deadline: { lt: now },
        job: { status: { notIn: [...DORMANT_JOB_STATUSES] } },
      },
      take: ATTENTION_LIMIT,
      // Furthest past its deadline first.
      orderBy: { deadline: 'asc' },
      select: {
        id: true,
        title: true,
        deadline: true,
        status: true,
        escalationCount: true,
        job: { select: { id: true, jobCode: true } },
        department: { select: { name: true } },
        assignee: { select: { name: true } },
      },
    }),
  ]);

  return {
    problems: problems
      .map((problem): AttentionProblem => ({
        id: problem.id,
        subtaskId: problem.subtask.id,
        jobId: problem.subtask.job.id,
        jobCode: problem.subtask.job.jobCode,
        subtaskTitle: problem.subtask.title,
        departmentName: problem.subtask.department.name,
        assigneeName: problem.subtask.assignee.name,
        severity: problem.severity,
        status: problem.status,
        description: problem.description,
        raisedAt: problem.createdAt.toISOString(),
        ageHours: round1((now.getTime() - problem.createdAt.getTime()) / 3_600_000),
      }))
      .sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          b.ageHours - a.ageHours,
      )
      .slice(0, ATTENTION_LIMIT),

    overdueSubtasks: overdue.map((subtask): AttentionSubtask => ({
      id: subtask.id,
      jobId: subtask.job.id,
      jobCode: subtask.job.jobCode,
      title: subtask.title,
      departmentName: subtask.department.name,
      assigneeName: subtask.assignee.name,
      deadline: subtask.deadline?.toISOString() ?? '',
      overdueHours: round1(overdueHours(subtask, now)),
      status: subtask.status,
      escalationCount: subtask.escalationCount,
    })),
  };
}

/**
 * At-risk and delayed jobs, each with the department holding it up.
 *
 * Two queries, not one per job. The second uses `DISTINCT ON` to pick the
 * single worst overdue subtask per job in one pass — the obvious
 * implementation, a findMany per job, would be one round trip per row on a
 * table the MD looks at every morning.
 */
export async function jobsAtRisk(now: Date = new Date()): Promise<JobAtRisk[]> {
  const jobs = await prisma.job.findMany({
    where: { status: { in: ['AT_RISK', 'DELAYED'] } },
    take: AT_RISK_LIMIT,
    orderBy: [{ status: 'desc' }, { overallDeadline: 'asc' }],
    select: {
      id: true,
      jobCode: true,
      title: true,
      status: true,
      overallDeadline: true,
    },
  });

  if (jobs.length === 0) return [];

  const ids = jobs.map((job) => job.id);

  const blocking = await prisma.$queryRaw<BlockingRow[]>`
    SELECT DISTINCT ON (s."jobId")
           s."jobId"                                         AS "jobId",
           d."name"                                          AS "departmentName",
           s."title"                                         AS "subtaskTitle",
           COUNT(*)      OVER (PARTITION BY s."jobId")        AS overdue_subtasks,
           COALESCE(p.open_problems, 0)                       AS open_problems
      FROM "Subtask" s
      JOIN "Department" d ON d."id" = s."departmentId"
      LEFT JOIN (
        SELECT s2."jobId", COUNT(*) AS open_problems
          FROM "Problem" pr
          JOIN "Subtask" s2 ON s2."id" = pr."subtaskId"
         WHERE pr."status" IN ('OPEN', 'ACKNOWLEDGED')
         GROUP BY s2."jobId"
      ) p ON p."jobId" = s."jobId"
     WHERE s."jobId" = ANY(${ids})
       AND s."deadline" < ${now}
       AND s."status" IN ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL')
     ORDER BY s."jobId", s."deadline" ASC
  `;

  const byJob = new Map(blocking.map((row) => [row.jobId, row]));

  return jobs.map((job): JobAtRisk => {
    const row = byJob.get(job.id);

    return {
      id: job.id,
      jobCode: job.jobCode,
      title: job.title,
      status: job.status,
      overallDeadline: job.overallDeadline.toISOString(),
      // A job can be AT_RISK on its overall deadline with nothing individually
      // overdue yet, so there is not always a department to name.
      blockingDepartment: row?.departmentName ?? null,
      blockingSubtaskTitle: row?.subtaskTitle ?? null,
      overdueSubtasks: Number(row?.overdue_subtasks ?? 0),
      openProblems: Number(row?.open_problems ?? 0),
    };
  });
}
