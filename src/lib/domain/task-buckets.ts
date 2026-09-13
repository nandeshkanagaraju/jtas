/**
 * Grouping a member's work into the buckets the My Tasks screen shows (FR-30).
 *
 * Pure, and IST-aware: "due today" means the Asia/Kolkata calendar day, not a
 * rolling 24 hours and not the server's day. A member in Coimbatore looking at
 * the screen at 11 PM must see tomorrow's work under "tomorrow", not under
 * "today" because the server is still on the previous UTC date.
 */
import type { SubtaskStatus } from '@prisma/client';

import { hoursBetween, istTimeOnDay, startOfISTDay } from '@/lib/utils/time';

/**
 * The buckets, in the order the screen presents them.
 *
 * `later` is not in the build spec's list of six, but without it a subtask due
 * in three weeks would belong to no bucket and simply vanish from the member's
 * screen. A member has to be able to see all of their work.
 */
export const BUCKET_ORDER = [
  'overdue',
  'dueToday',
  'dueThisWeek',
  'blocked',
  'awaitingApproval',
  'later',
  'recentlyCompleted',
] as const;

export type BucketName = (typeof BUCKET_ORDER)[number];

/** The shape the bucketer needs; the service loads more than this. */
export interface BucketableTask {
  status: SubtaskStatus;
  /** UTC instant. */
  deadline: Date;
  completedAt: Date | null;
}

/** How far back "recently completed" reaches. */
export const RECENTLY_COMPLETED_DAYS = 7;

/** How far forward "due this week" reaches, counted in IST calendar days. */
export const THIS_WEEK_DAYS = 7;

/**
 * A subtask is overdue when its deadline has passed and it is not finished —
 * a derived condition, never a status (PDD improvement I-08).
 */
export function isOverdue(task: BucketableTask, now: Date): boolean {
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return now.getTime() > task.deadline.getTime();
}

/**
 * Decides the single bucket a task belongs to.
 *
 * Buckets are mutually exclusive and the precedence is deliberate:
 *
 *  1. Finished work leaves the working set entirely.
 *  2. `BLOCKED` and `AWAITING_APPROVAL` are *status* buckets, because neither
 *     is something the member can act on — surfacing a blocked task under
 *     "overdue" would ask them to do work the system itself is preventing.
 *  3. Everything still actionable is bucketed by its deadline.
 *
 * Cancelled work and anything on hold return `null`: it is nobody's to do, and
 * showing it would only add noise to a screen that has to be readable in
 * seconds.
 */
export function bucketFor(task: BucketableTask, now: Date): BucketName | null {
  if (task.status === 'CANCELLED') return null;
  if (task.status === 'ON_HOLD') return null;

  if (task.status === 'COMPLETED') {
    if (!task.completedAt) return null;
    const ageHours = hoursBetween(task.completedAt, now);
    return ageHours <= RECENTLY_COMPLETED_DAYS * 24 && ageHours >= 0 ? 'recentlyCompleted' : null;
  }

  if (task.status === 'BLOCKED') return 'blocked';
  if (task.status === 'AWAITING_APPROVAL') return 'awaitingApproval';

  // PENDING, IN_PROGRESS and PROBLEM are bucketed by deadline.
  if (isOverdue(task, now)) return 'overdue';

  // IST calendar day boundaries, so "today" ends at midnight in Coimbatore.
  const endOfToday = istTimeOnDay(now, 0, 1);
  if (task.deadline.getTime() < endOfToday.getTime()) return 'dueToday';

  const endOfWeek = istTimeOnDay(now, 0, THIS_WEEK_DAYS);
  if (task.deadline.getTime() < endOfWeek.getTime()) return 'dueThisWeek';

  return 'later';
}

export type Buckets<T> = Record<BucketName, T[]>;

function emptyBuckets<T>(): Buckets<T> {
  return {
    overdue: [],
    dueToday: [],
    dueThisWeek: [],
    blocked: [],
    awaitingApproval: [],
    later: [],
    recentlyCompleted: [],
  };
}

/**
 * Sorts every task into its bucket.
 *
 * Within a bucket, tasks are ordered by deadline ascending — the next thing to
 * do is always at the top. `recentlyCompleted` is ordered by completion time
 * descending instead, because there the interesting end is the most recent.
 */
export function groupTasks<T extends BucketableTask>(tasks: readonly T[], now: Date): Buckets<T> {
  const buckets = emptyBuckets<T>();

  for (const task of tasks) {
    const bucket = bucketFor(task, now);
    if (bucket) buckets[bucket].push(task);
  }

  for (const name of BUCKET_ORDER) {
    buckets[name].sort((a, b) =>
      name === 'recentlyCompleted'
        ? (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
        : a.deadline.getTime() - b.deadline.getTime(),
    );
  }

  return buckets;
}

/** Signed hours until the deadline; negative once it has passed. */
export function hoursRemaining(task: BucketableTask, now: Date): number {
  return Math.round(hoursBetween(now, task.deadline) * 10) / 10;
}

/** Counts for the sticky summary strip. */
export interface TaskSummary {
  overdue: number;
  dueToday: number;
  openProblems: number;
  blocked: number;
  awaitingApproval: number;
}

export function summarise<T extends BucketableTask & { hasOpenProblem: boolean }>(
  buckets: Buckets<T>,
): TaskSummary {
  const openProblems = BUCKET_ORDER.filter((name) => name !== 'recentlyCompleted').reduce(
    (total, name) => total + buckets[name].filter((task) => task.hasOpenProblem).length,
    0,
  );

  return {
    overdue: buckets.overdue.length,
    dueToday: buckets.dueToday.length,
    openProblems,
    blocked: buckets.blocked.length,
    awaitingApproval: buckets.awaitingApproval.length,
  };
}

/** Test seam and documentation: the IST day boundary a bucket uses. */
export function istDayBoundaries(now: Date): { startOfToday: Date; endOfToday: Date } {
  return { startOfToday: startOfISTDay(now), endOfToday: istTimeOnDay(now, 0, 1) };
}
