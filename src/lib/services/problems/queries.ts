/**
 * The MD's problem inbox — FR-41.
 */
import type { Prisma, ProblemSeverity, ProblemStatus } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import {
  ageBucketOf,
  countProblems,
  isStale,
  problemAgeHours,
  sortForInbox,
  type AgeBucket,
  type ProblemCounts,
} from '@/lib/domain/problem-triage';
import { notFound } from '@/lib/errors';
import type { ListProblemsQuery } from '@/lib/validation/problem';

import { LIVE_PROBLEM_STATUSES } from './core';

const PROBLEM_SELECT = {
  id: true,
  subtaskId: true,
  raisedById: true,
  description: true,
  severity: true,
  status: true,
  acknowledgedAt: true,
  mdActionNote: true,
  resolvedById: true,
  resolvedAt: true,
  createdAt: true,
  subtask: {
    select: {
      id: true,
      title: true,
      deadline: true,
      status: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true, email: true } },
      department: { select: { id: true, name: true, code: true, sequenceOrder: true } },
      job: { select: { id: true, jobCode: true, title: true, partNumber: true } },
    },
  },
} satisfies Prisma.ProblemSelect;

type ProblemRow = Prisma.ProblemGetPayload<{ select: typeof PROBLEM_SELECT }>;

/** One row of the inbox. */
export interface ProblemSummary {
  id: string;
  description: string;
  severity: ProblemSeverity;
  status: ProblemStatus;
  raisedBy: { id: string; name: string } | null;
  acknowledgedAt: Date | null;
  mdActionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  /** Hours since it was raised — the inbox's most important column. */
  ageHours: number;
  ageBucket: AgeBucket;
  /** Open longer than a day (PDD section 12). */
  isStale: boolean;
  subtask: {
    id: string;
    title: string;
    deadline: Date | null;
    status: string;
    assignee: { id: string; name: string; email: string };
    department: { id: string; name: string; code: string };
    job: { id: string; jobCode: string; title: string; partNumber: string | null };
  };
}

export interface ProblemInbox {
  data: ProblemSummary[];
  counts: ProblemCounts;
}

function toSummary(row: ProblemRow, now: Date, raisedByName: string | null): ProblemSummary {
  return {
    id: row.id,
    description: row.description,
    severity: row.severity,
    status: row.status,
    raisedBy: raisedByName ? { id: row.raisedById, name: raisedByName } : null,
    acknowledgedAt: row.acknowledgedAt,
    mdActionNote: row.mdActionNote,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    ageHours: problemAgeHours(row, now),
    ageBucket: ageBucketOf(row, now),
    isStale: isStale(row, now),
    subtask: {
      id: row.subtask.id,
      title: row.subtask.title,
      deadline: row.subtask.deadline,
      status: row.subtask.status,
      assignee: row.subtask.assignee,
      department: row.subtask.department,
      job: row.subtask.job,
    },
  };
}

/**
 * Lists problems for the inbox.
 *
 * Sorted in memory by the pure comparator rather than in SQL: the order is a
 * product judgement (severity, then age, then how untouched it is) and it is
 * worth having it tested and readable in one place. At this volume — tens of
 * open problems — the cost is nothing.
 */
export async function listProblems(
  query: ListProblemsQuery,
  now: Date = new Date(),
): Promise<ProblemInbox> {
  const where: Prisma.ProblemWhereInput = {};

  if (query.status) where.status = query.status;
  else if (query.open) where.status = { in: [...LIVE_PROBLEM_STATUSES] };

  if (query.severity) where.severity = query.severity;

  // Built as one object: Prisma's relation filter is not spreadable, so
  // assigning `subtask` twice would drop the first condition.
  const subtaskWhere: Prisma.SubtaskWhereInput = {};
  if (query.jobId) subtaskWhere.jobId = query.jobId;
  if (query.departmentId) subtaskWhere.departmentId = query.departmentId;
  if (Object.keys(subtaskWhere).length > 0) where.subtask = subtaskWhere;

  const rows = await prisma.problem.findMany({
    where,
    select: PROBLEM_SELECT,
    // A generous cap rather than pagination: an inbox with more than this in it
    // has a bigger problem than its scroll position.
    take: 200,
  });

  // `Problem.raisedById` has no relation on the model, so the names are
  // resolved in one extra query rather than through an include.
  const names = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.raisedById))] } },
    select: { id: true, name: true },
  });
  const nameById = new Map(names.map((user) => [user.id, user.name]));

  const summaries = sortForInbox(rows).map((row) =>
    toSummary(row, now, nameById.get(row.raisedById) ?? null),
  );

  const filtered = query.ageBucket
    ? summaries.filter((problem) => problem.ageBucket === query.ageBucket)
    : summaries;

  return { data: filtered, counts: countProblems(rows, now) };
}

/** Live problems on a job, for the amber markers on its timeline (M6.4). */
export async function listOpenProblemsForJob(jobId: string): Promise<ProblemSummary[]> {
  const { data } = await listProblems({
    jobId,
    open: true,
  } as ListProblemsQuery);
  return data;
}

/** @throws {AppError} `NOT_FOUND` */
export async function getProblem(problemId: string, now: Date = new Date()) {
  const row = await prisma.problem.findUnique({
    where: { id: problemId },
    select: PROBLEM_SELECT,
  });
  if (!row) throw notFound('Problem');

  const raisedBy = await prisma.user.findUnique({
    where: { id: row.raisedById },
    select: { name: true },
  });

  return toSummary(row, now, raisedBy?.name ?? null);
}

/** The raw row a mutation needs, without the summary shaping. */
export async function loadProblemForWrite(problemId: string) {
  const row = await prisma.problem.findUnique({
    where: { id: problemId },
    select: PROBLEM_SELECT,
  });
  if (!row) throw notFound('Problem');
  return row;
}

export type { ProblemRow };
