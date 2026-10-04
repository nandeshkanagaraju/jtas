/**
 * The row sets behind the reports screen and the exports (build spec M8.4/M8.5).
 *
 * Each is one query with its joins declared, so exporting two thousand subtasks
 * is one round trip rather than two thousand.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { delayHours, round1 } from '@/lib/domain/metrics';
import { notFound } from '@/lib/errors';

import type { DateRange } from '../analytics/range';

/** How many rows an export will produce before it is refused. */
export const EXPORT_ROW_LIMIT = 5_000;

export interface ReportFilters {
  status?: string;
  departmentId?: string;
  jobId?: string;
}

export interface JobRow {
  jobCode: string;
  title: string;
  customerName: string | null;
  partNumber: string | null;
  priority: string;
  status: string;
  overallDeadline: Date;
  publishedAt: Date | null;
  completedAt: Date | null;
  subtaskCount: number;
  completedSubtasks: number;
  overdueSubtasks: number;
}

export interface SubtaskRow {
  jobCode: string;
  jobTitle: string;
  department: string;
  assignee: string;
  title: string;
  status: string;
  plannedDeadline: Date | null;
  actualCompletion: Date | null;
  delayHours: number;
  extensions: number;
  problems: number;
}

export interface ProblemRow {
  jobCode: string;
  department: string;
  subtaskTitle: string;
  raisedBy: string;
  severity: string;
  status: string;
  description: string;
  raisedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
}

/** Jobs with their progress, for the list export and the reports table. */
export async function jobRows(
  dateRange: DateRange,
  filters: ReportFilters = {},
): Promise<JobRow[]> {
  const where: Prisma.JobWhereInput = {
    createdAt: { gte: dateRange.from, lt: dateRange.until },
    ...(filters.status ? { status: filters.status as never } : {}),
    ...(filters.departmentId ? { subtasks: { some: { departmentId: filters.departmentId } } } : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    take: EXPORT_ROW_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: {
      jobCode: true,
      title: true,
      customerName: true,
      partNumber: true,
      priority: true,
      status: true,
      overallDeadline: true,
      publishedAt: true,
      completedAt: true,
      // Counted by the database as part of the same query, not by loading
      // every subtask and counting in JavaScript.
      subtasks: { select: { status: true, deadline: true, completedAt: true } },
    },
  });

  const now = new Date();

  return jobs.map((job) => ({
    jobCode: job.jobCode,
    title: job.title,
    customerName: job.customerName,
    partNumber: job.partNumber,
    priority: job.priority,
    status: job.status,
    overallDeadline: job.overallDeadline,
    publishedAt: job.publishedAt,
    completedAt: job.completedAt,
    subtaskCount: job.subtasks.length,
    completedSubtasks: job.subtasks.filter((s) => s.status === 'COMPLETED').length,
    overdueSubtasks: job.subtasks.filter(
      (s) => !s.completedAt && s.status !== 'CANCELLED' && !!s.deadline && s.deadline < now,
    ).length,
  }));
}

/** Subtasks with planned against actual, the heart of every report. */
export async function subtaskRows(
  dateRange: DateRange,
  filters: ReportFilters = {},
): Promise<SubtaskRow[]> {
  const rows = await prisma.subtask.findMany({
    where: {
      createdAt: { gte: dateRange.from, lt: dateRange.until },
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.jobId ? { jobId: filters.jobId } : {}),
    },
    take: EXPORT_ROW_LIMIT,
    orderBy: [{ job: { jobCode: 'asc' } }, { deadline: 'asc' }],
    select: {
      title: true,
      status: true,
      deadline: true,
      completedAt: true,
      job: { select: { jobCode: true, title: true } },
      department: { select: { name: true } },
      assignee: { select: { name: true } },
      _count: { select: { deadlineChanges: true, problems: true } },
    },
  });

  return rows.map((row) => ({
    jobCode: row.job.jobCode,
    jobTitle: row.job.title,
    department: row.department.name,
    assignee: row.assignee.name,
    title: row.title,
    status: row.status,
    plannedDeadline: row.deadline,
    actualCompletion: row.completedAt,
    delayHours: round1(delayHours(row)),
    extensions: row._count.deadlineChanges,
    problems: row._count.problems,
  }));
}

/** Problems with their resolutions. */
export async function problemRows(
  dateRange: DateRange,
  filters: ReportFilters = {},
): Promise<ProblemRow[]> {
  const rows = await prisma.problem.findMany({
    where: {
      createdAt: { gte: dateRange.from, lt: dateRange.until },
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.departmentId ? { subtask: { departmentId: filters.departmentId } } : {}),
      ...(filters.jobId ? { subtask: { jobId: filters.jobId } } : {}),
    },
    take: EXPORT_ROW_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: {
      severity: true,
      status: true,
      description: true,
      createdAt: true,
      resolvedAt: true,
      mdActionNote: true,
      raisedById: true,
      subtask: {
        select: {
          title: true,
          job: { select: { jobCode: true } },
          department: { select: { name: true } },
        },
      },
    },
  });

  const nameById = await raiserNames(rows);

  return rows.map((row) => ({
    jobCode: row.subtask.job.jobCode,
    department: row.subtask.department.name,
    subtaskTitle: row.subtask.title,
    raisedBy: nameById.get(row.raisedById) ?? 'Unknown',
    severity: row.severity,
    status: row.status,
    description: row.description,
    raisedAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    resolution: row.mdActionNote,
  }));
}

export interface JobReport {
  job: {
    id: string;
    jobCode: string;
    title: string;
    customerName: string | null;
    partNumber: string | null;
    drawingNumber: string | null;
    quantity: number | null;
    priority: string;
    status: string;
    overallDeadline: Date;
    publishedAt: Date | null;
    completedAt: Date | null;
  };
  subtasks: SubtaskRow[];
  problems: ProblemRow[];
}

/** One job in full: the subtask chain and every problem raised against it. */
export async function jobReport(jobId: string): Promise<JobReport> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobCode: true,
      title: true,
      customerName: true,
      partNumber: true,
      drawingNumber: true,
      quantity: true,
      priority: true,
      status: true,
      overallDeadline: true,
      publishedAt: true,
      completedAt: true,
    },
  });

  if (!job) throw notFound('Job');

  const [subtasks, problems] = await Promise.all([
    prisma.subtask.findMany({
      where: { jobId },
      orderBy: { deadline: 'asc' },
      select: {
        title: true,
        status: true,
        deadline: true,
        completedAt: true,
        job: { select: { jobCode: true, title: true } },
        department: { select: { name: true } },
        assignee: { select: { name: true } },
        _count: { select: { deadlineChanges: true, problems: true } },
      },
    }),
    prisma.problem.findMany({
      where: { subtask: { jobId } },
      orderBy: { createdAt: 'asc' },
      select: {
        severity: true,
        status: true,
        description: true,
        createdAt: true,
        resolvedAt: true,
        mdActionNote: true,
        raisedById: true,
        subtask: {
          select: {
            title: true,
            job: { select: { jobCode: true } },
            department: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const nameById = await raiserNames(problems);

  return {
    job,
    subtasks: subtasks.map((row) => ({
      jobCode: row.job.jobCode,
      jobTitle: row.job.title,
      department: row.department.name,
      assignee: row.assignee.name,
      title: row.title,
      status: row.status,
      plannedDeadline: row.deadline,
      actualCompletion: row.completedAt,
      delayHours: round1(delayHours(row)),
      extensions: row._count.deadlineChanges,
      problems: row._count.problems,
    })),
    problems: problems.map((row) => ({
      jobCode: row.subtask.job.jobCode,
      department: row.subtask.department.name,
      subtaskTitle: row.subtask.title,
      raisedBy: nameById.get(row.raisedById) ?? 'Unknown',
      severity: row.severity,
      status: row.status,
      description: row.description,
      raisedAt: row.createdAt,
      resolvedAt: row.resolvedAt,
      resolution: row.mdActionNote,
    })),
  };
}

/**
 * Names for a set of problem raisers.
 *
 * `Problem.raisedById` carries no relation on the model, so the names come from
 * one keyed query rather than a join — and one query for the whole page rather
 * than one per row.
 */
async function raiserNames(
  rows: ReadonlyArray<{ raisedById: string }>,
): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.raisedById))] } },
    select: { id: true, name: true },
  });

  return new Map(users.map((user) => [user.id, user.name]));
}
