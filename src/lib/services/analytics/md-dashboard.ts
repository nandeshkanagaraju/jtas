/**
 * The MD dashboard's numbers (build spec M8.1).
 *
 * Everything here runs as one parallel batch of aggregate queries. The rule is
 * that the cost must not grow with the number of jobs: counting is done in
 * PostgreSQL, never by loading rows and counting them in JavaScript, and no
 * query runs inside a loop. With 500 jobs and 4,000 subtasks the whole set is a
 * handful of index scans.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { percentOf, round1 } from '@/lib/domain/metrics';

import { jobsAtRisk, needsAttention } from './attention';
import { dayKeysIn, lastDays, type DateRange } from './range';
import type { KpiCounts, MdDashboard, TrendPoint } from './types';

/**
 * Subtask states that can be overdue.
 *
 * The same list the sweeper chases — `PROBLEM` is absent because a reported
 * blocker has already moved the problem to the MD, and `ON_HOLD`, `COMPLETED`
 * and `CANCELLED` because there is nothing to be late for.
 */
const OVERDUE_STATUSES: Prisma.SubtaskWhereInput['status'] = {
  in: ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL'],
};

/** Jobs whose subtasks are not being chased. */
const DORMANT_JOB_STATUSES = ['ON_HOLD', 'CANCELLED', 'DRAFT'] as const;

interface OnTimeRow {
  completed: bigint;
  on_time: bigint;
  total_delay_hours: number | null;
}

interface TrendRow {
  day: Date;
  on_time: bigint;
  late: bigint;
}

/** The whole dashboard payload for one range. */
export async function mdDashboard(
  dateRange: DateRange,
  now: Date = new Date(),
): Promise<MdDashboard> {
  const trendRange = lastDays(30, now);

  const [kpis, onTime, trend, attention, atRisk] = await Promise.all([
    kpiCounts(dateRange, now),
    onTimeAggregate(dateRange),
    trendSeries(trendRange),
    needsAttention(now),
    jobsAtRisk(now),
  ]);

  return {
    range: { from: dateRange.fromKey, to: dateRange.toKey },
    kpis,
    onTimeCompletionPercent: percentOf(onTime.onTime, onTime.completed),
    averageDelayHours:
      onTime.completed === 0 ? 0 : round1(onTime.totalDelayHours / onTime.completed),
    completedInRange: onTime.completed,
    trend,
    attention,
    jobsAtRisk: atRisk,
  };
}

/** The six tiles. */
export async function kpiCounts(dateRange: DateRange, now: Date): Promise<KpiCounts> {
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const [byStatus, completedThisMonth, overdueSubtasks, openProblems, staleProblems] =
    await Promise.all([
      // One pass for the three job-state tiles rather than three counts.
      prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),

      prisma.job.count({
        where: { status: 'COMPLETED', completedAt: { gte: dateRange.from, lt: dateRange.until } },
      }),

      prisma.subtask.count({
        where: {
          status: OVERDUE_STATUSES,
          deadline: { lt: now },
          job: { status: { notIn: [...DORMANT_JOB_STATUSES] } },
        },
      }),

      prisma.problem.count({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),

      prisma.problem.count({
        where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, createdAt: { lt: dayAgo } },
      }),
    ]);

  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;

  return {
    activeJobs: count('IN_PROGRESS') + count('AT_RISK') + count('DELAYED'),
    atRiskJobs: count('AT_RISK'),
    delayedJobs: count('DELAYED'),
    completedThisMonth,
    overdueSubtasks,
    openProblems,
    openProblemsOlderThan24h: staleProblems,
  };
}

/**
 * On-time count and total lateness for completed work in the range.
 *
 * Done as one aggregate rather than by loading the subtasks: the comparison is
 * exactly `lib/domain/metrics`' rule — `completedAt <= deadline`, cancelled work
 * excluded — and `changeDeadline` refuses a closed subtask, so the stored
 * `deadline` is the one that was in force when the work finished.
 */
export async function onTimeAggregate(dateRange: DateRange): Promise<{
  completed: number;
  onTime: number;
  totalDelayHours: number;
}> {
  const [row] = await prisma.$queryRaw<OnTimeRow[]>`
    SELECT
      COUNT(*) AS completed,
      COUNT(*) FILTER (WHERE "completedAt" <= "deadline") AS on_time,
      COALESCE(
        SUM(
          GREATEST(EXTRACT(EPOCH FROM ("completedAt" - "deadline")), 0) / 3600.0
        ),
        0
      )::float8 AS total_delay_hours
      FROM "Subtask"
     WHERE "status" = 'COMPLETED'
       AND "completedAt" IS NOT NULL
       AND "completedAt" >= ${dateRange.from}
       AND "completedAt" <  ${dateRange.until}
  `;

  return {
    completed: Number(row?.completed ?? 0),
    onTime: Number(row?.on_time ?? 0),
    totalDelayHours: row?.total_delay_hours ?? 0,
  };
}

/**
 * Completed-on-time against completed-late, per IST day.
 *
 * Grouped in the database by the Coimbatore calendar day: a subtask finished at
 * 9 PM IST is stored as 15:30 UTC, and grouping by the UTC date would file the
 * evening's work under the day before.
 */
export async function trendSeries(dateRange: DateRange): Promise<TrendPoint[]> {
  const rows = await prisma.$queryRaw<TrendRow[]>`
    SELECT
      ("completedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS day,
      COUNT(*) FILTER (WHERE "completedAt" <= "deadline") AS on_time,
      COUNT(*) FILTER (WHERE "completedAt" >  "deadline") AS late
      FROM "Subtask"
     WHERE "status" = 'COMPLETED'
       AND "completedAt" IS NOT NULL
       AND "completedAt" >= ${dateRange.from}
       AND "completedAt" <  ${dateRange.until}
     GROUP BY 1
     ORDER BY 1
  `;

  const byDay = new Map(
    rows.map((row) => [
      // ::date comes back as a Date at UTC midnight; its UTC parts are the IST
      // calendar day we grouped by.
      row.day.toISOString().slice(0, 10),
      { onTime: Number(row.on_time), late: Number(row.late) },
    ]),
  );

  // Every day in the window appears, so a quiet Sunday is a gap in the line
  // rather than a missing point the chart would interpolate across.
  return dayKeysIn(dateRange).map((day) => ({
    day,
    onTime: byDay.get(day)?.onTime ?? 0,
    late: byDay.get(day)?.late ?? 0,
  }));
}
