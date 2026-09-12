/**
 * Read paths for jobs.
 *
 * The member scope is applied **in the query**, not by filtering after the
 * fetch (build spec M3.2). Fetching everything and discarding rows would leak
 * the real total, leak row counts through pagination, and put every job in the
 * process memory of a request that is not allowed to see them.
 */
import type { Prisma, SubtaskStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { isSubtaskOverdue, jobProgress } from '@/lib/domain/job-status';
import { notFound } from '@/lib/errors';
import type { SessionUser } from '@/lib/auth/session';
import { fromISTInput } from '@/lib/utils/time';
import type { ListJobsQuery } from '@/lib/validation/job';

import { JOB_SELECT, toJobSummary, type JobRow, type JobSummary } from './types';

/** Subtask fields every read path needs for progress, departments and overdue. */
const SUBTASK_FACETS = {
  select: {
    status: true,
    deadline: true,
    department: { select: { id: true, name: true, code: true, sequenceOrder: true } },
  },
} satisfies Prisma.Job$subtasksArgs;

export interface JobListResult {
  data: JobSummary[];
  total: number;
  /** Pass back as `?cursor=` for the next page; null when the list is exhausted. */
  nextCursor: string | null;
  page: number;
  pageSize: number;
}

/**
 * Restricts a query to what `user` may see (SDD section 6.3).
 *
 * MD, Deputy and Admin see everything. A member sees only jobs where they hold
 * at least one subtask, or which they created.
 */
export function visibilityFilter(user: SessionUser): Prisma.JobWhereInput {
  if (user.role === 'MD' || user.role === 'DEPUTY_MD' || user.role === 'ADMIN') return {};

  return {
    OR: [{ subtasks: { some: { assigneeId: user.id } } }, { createdById: user.id }],
  };
}

/** Translates the filter half of the query into a Prisma `where`. */
function buildWhere(user: SessionUser, query: ListJobsQuery): Prisma.JobWhereInput {
  const filters: Prisma.JobWhereInput[] = [visibilityFilter(user)];

  if (query.status) filters.push({ status: query.status });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.departmentId) {
    filters.push({ subtasks: { some: { departmentId: query.departmentId } } });
  }

  if (query.from || query.to) {
    const range: Prisma.DateTimeFilter = {};
    // The range is expressed in IST days: `from` starts at 00:00 IST, `to`
    // ends at 23:59 IST, which is what a user picking two dates means.
    if (query.from) range.gte = fromISTInput(`${query.from}T00:00`);
    if (query.to) range.lte = fromISTInput(`${query.to}T23:59`);
    filters.push({ overallDeadline: range });
  }

  if (query.q) {
    filters.push({
      OR: [
        { jobCode: { contains: query.q, mode: 'insensitive' } },
        { title: { contains: query.q, mode: 'insensitive' } },
        { partNumber: { contains: query.q, mode: 'insensitive' } },
        { customerName: { contains: query.q, mode: 'insensitive' } },
        { drawingNumber: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: filters };
}

export async function listJobs(user: SessionUser, query: ListJobsQuery): Promise<JobListResult> {
  const where = buildWhere(user, query);

  // `id` breaks ties so the order is total: without it, two jobs sharing a
  // deadline could swap places between pages and a cursor could skip one.
  const orderBy: Prisma.JobOrderByWithRelationInput[] = [
    { [query.sort]: query.direction },
    { id: 'asc' },
  ];

  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      select: { ...JOB_SELECT, subtasks: SUBTASK_FACETS },
      orderBy,
      take: query.pageSize,
      ...(query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : { skip: (query.page - 1) * query.pageSize }),
    }),
    prisma.job.count({ where }),
  ]);

  const now = new Date();

  return {
    data: rows.map((row) => summarise(row, now)),
    total,
    // A short page means there is nothing after it.
    nextCursor: rows.length === query.pageSize ? (rows.at(-1)?.id ?? null) : null,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** A job row loaded with the subtask facets every read path needs. */
type JobWithFacets = JobRow & {
  subtasks: Array<{
    status: SubtaskStatus;
    deadline: Date;
    department: { id: string; name: string; code: string; sequenceOrder: number };
  }>;
};

/** Shapes one row, deriving progress, involved departments and overdue-ness. */
function summarise(row: JobWithFacets, now: Date): JobSummary {
  const departments = [
    ...new Map(row.subtasks.map((subtask) => [subtask.department.id, subtask.department])).values(),
  ]
    // Shop-flow order, which is how every screen shows departments (PDD 6.1).
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    .map(({ id, name, code }) => ({ id, name, code }));

  return toJobSummary(row, {
    progress: jobProgress(row.subtasks),
    departments,
    hasOverdueSubtask: row.subtasks.some((subtask) => isSubtaskOverdue(subtask, now)),
  });
}

/**
 * Loads one job, scoped by the same visibility rule as the list.
 *
 * A member asking for a job they have no subtask on gets `NOT_FOUND`, not
 * `FORBIDDEN` — confirming that a job code exists is itself information.
 *
 * @throws {AppError} `NOT_FOUND`
 */
export async function getJob(user: SessionUser, jobId: string): Promise<JobSummary> {
  const row = await prisma.job.findFirst({
    where: { AND: [{ id: jobId }, visibilityFilter(user)] },
    select: { ...JOB_SELECT, subtasks: SUBTASK_FACETS },
  });

  if (!row) throw notFound('Job');

  return summarise(row, new Date());
}

/** Loads a job for a mutation, ignoring visibility — the caller checks `can()`. */
export async function loadJobForWrite(jobId: string) {
  const row = await prisma.job.findUnique({ where: { id: jobId }, select: JOB_SELECT });
  if (!row) throw notFound('Job');
  return row;
}
