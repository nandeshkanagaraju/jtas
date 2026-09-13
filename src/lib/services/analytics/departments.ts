/**
 * Department scorecards (build spec M8.2).
 *
 * Every figure for all eight departments comes from five aggregate queries,
 * each grouped by department in PostgreSQL. Nothing loops over departments and
 * nothing loads a subtask row — the comparison table is the same cost whether
 * the company has run eight jobs or eight hundred.
 */
import { prisma } from '@/lib/db/prisma';
import { percentOf, round1 } from '@/lib/domain/metrics';
import { notFound } from '@/lib/errors';

import type { DateRange } from './range';
import type { DepartmentReport, DepartmentScorecard } from './types';

const OPEN_SUBTASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'PROBLEM', 'AWAITING_APPROVAL'];

interface CompletionRow {
  departmentId: string;
  completed: bigint;
  on_time: bigint;
  total_delay_hours: number | null;
}

interface CountRow {
  departmentId: string;
  count: bigint;
}

/** One department, plus every department for the same range. */
export async function departmentReport(
  departmentId: string,
  dateRange: DateRange,
): Promise<DepartmentReport> {
  const comparison = await departmentScorecards(dateRange);
  const department = comparison.find((row) => row.departmentId === departmentId);

  if (!department) throw notFound('Department');

  return {
    range: { from: dateRange.fromKey, to: dateRange.toKey },
    department,
    comparison,
  };
}

/** Every department's record over the range, best on-time rate first. */
export async function departmentScorecards(dateRange: DateRange): Promise<DepartmentScorecard[]> {
  const [departments, completion, open, problems, rootCause, extensions] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      orderBy: { sequenceOrder: 'asc' },
      select: { id: true, code: true, name: true },
    }),
    completionByDepartment(dateRange),
    openByDepartment(),
    problemsByDepartment(dateRange),
    rootCauseByDepartment(dateRange),
    extensionsByDepartment(dateRange),
  ]);

  return departments.map((department): DepartmentScorecard => {
    const row = completion.get(department.id);
    const completed = Number(row?.completed ?? 0);
    const onTime = Number(row?.on_time ?? 0);

    return {
      departmentId: department.id,
      code: department.code,
      name: department.name,
      onTimePercent: percentOf(onTime, completed),
      averageDelayHours: completed === 0 ? 0 : round1((row?.total_delay_hours ?? 0) / completed),
      subtasksCompleted: completed,
      onTime,
      late: completed - onTime,
      currentOpen: open.get(department.id) ?? 0,
      problemsRaised: problems.get(department.id) ?? 0,
      problemsWhereThisDepartmentWasTheRootCause: rootCause.get(department.id) ?? 0,
      extensionCount: extensions.get(department.id) ?? 0,
    };
  });
}

/** Completed count, on-time count and total lateness, grouped by department. */
async function completionByDepartment(dateRange: DateRange): Promise<Map<string, CompletionRow>> {
  const rows = await prisma.$queryRaw<CompletionRow[]>`
    SELECT "departmentId",
           COUNT(*)                                         AS completed,
           COUNT(*) FILTER (WHERE "completedAt" <= "deadline") AS on_time,
           COALESCE(
             SUM(GREATEST(EXTRACT(EPOCH FROM ("completedAt" - "deadline")), 0) / 3600.0),
             0
           )::float8                                        AS total_delay_hours
      FROM "Subtask"
     WHERE "status" = 'COMPLETED'
       AND "completedAt" IS NOT NULL
       AND "completedAt" >= ${dateRange.from}
       AND "completedAt" <  ${dateRange.until}
     GROUP BY "departmentId"
  `;

  return new Map(rows.map((row) => [row.departmentId, row]));
}

/**
 * Work in hand right now, per department.
 *
 * Deliberately not range-bound: "currently open" is a statement about today, and
 * filtering it by last month's dates would report a backlog that has since been
 * cleared.
 */
async function openByDepartment(): Promise<Map<string, number>> {
  const rows = await prisma.subtask.groupBy({
    by: ['departmentId'],
    where: {
      status: { in: OPEN_SUBTASK_STATUSES as never },
      job: { status: { notIn: ['CANCELLED', 'DRAFT'] } },
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.departmentId, row._count._all]));
}

/** Problems raised on this department's subtasks in the range. */
async function problemsByDepartment(dateRange: DateRange): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT s."departmentId" AS "departmentId", COUNT(*) AS count
      FROM "Problem" p
      JOIN "Subtask" s ON s."id" = p."subtaskId"
     WHERE p."createdAt" >= ${dateRange.from}
       AND p."createdAt" <  ${dateRange.until}
     GROUP BY s."departmentId"
  `;

  return toCountMap(rows);
}

/**
 * Problems where this department's trouble became somebody else's delay.
 *
 * The spec's definition: an open or resolved problem on a subtask that at least
 * one dependent subtask was waiting on. This is the number that distinguishes a
 * department with a hard job from one that holds up the shop — raising problems
 * is not a fault, blocking the next bench is.
 */
async function rootCauseByDepartment(dateRange: DateRange): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT s."departmentId" AS "departmentId", COUNT(DISTINCT p."id") AS count
      FROM "Problem" p
      JOIN "Subtask" s   ON s."id" = p."subtaskId"
      JOIN "Subtask" dep ON dep."dependsOnId" = s."id"
     WHERE p."createdAt" >= ${dateRange.from}
       AND p."createdAt" <  ${dateRange.until}
       AND p."status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')
     GROUP BY s."departmentId"
  `;

  return toCountMap(rows);
}

/**
 * Deadline moves, per department.
 *
 * Reported next to the on-time rate so an extension cannot quietly launder a
 * delay: a department at 100% having moved nine deadlines is a different story
 * from one at 100% having moved none. That pairing is a judgement of mine —
 * improvement I-11 creates the extension request flow, and says nothing about
 * how the result should be measured.
 */
async function extensionsByDepartment(dateRange: DateRange): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT s."departmentId" AS "departmentId", COUNT(*) AS count
      FROM "DeadlineChange" dc
      JOIN "Subtask" s ON s."id" = dc."subtaskId"
     WHERE dc."createdAt" >= ${dateRange.from}
       AND dc."createdAt" <  ${dateRange.until}
     GROUP BY s."departmentId"
  `;

  return toCountMap(rows);
}

function toCountMap(rows: readonly CountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.departmentId, Number(row.count)]));
}
