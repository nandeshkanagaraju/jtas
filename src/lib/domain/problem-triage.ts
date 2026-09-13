/**
 * Ordering and ageing for the MD's problem inbox — FR-41.
 *
 * Pure. The inbox's whole job is to put the thing that most needs a decision at
 * the top, and "most" is a judgement the product makes on the MD's behalf — so
 * it belongs in a tested function rather than in an ORDER BY nobody reads.
 *
 * PDD section 12 names the failure this prevents: "MD does not clear the
 * problem inbox, and the tool becomes a graveyard." The mitigation is the age
 * flag below.
 */
import type { ProblemSeverity, ProblemStatus } from '@prisma/client';

import { hoursBetween } from '@/lib/utils/time';

/**
 * How long an open problem may sit before the dashboard calls it out in red.
 *
 * PDD section 12 sets the 24 hours: "problems older than 24 h flagged red on
 * the dashboard". The two-hour figure is from section 10's success metrics —
 * "Median time from problem raised to MD action … < 2 hours" — so a day is
 * already a long way past acceptable.
 */
export const STALE_PROBLEM_HOURS = 24;

/** Most serious first. A blocker stops a job; a low is a note. */
const SEVERITY_RANK: Record<ProblemSeverity, number> = {
  BLOCKER: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/** Open before acknowledged: an unread problem needs a decision more. */
const STATUS_RANK: Record<ProblemStatus, number> = {
  OPEN: 0,
  ACKNOWLEDGED: 1,
  RESOLVED: 2,
  REJECTED: 3,
};

export interface TriageableProblem {
  severity: ProblemSeverity;
  status: ProblemStatus;
  createdAt: Date;
}

/** Whole hours since the problem was raised. */
export function problemAgeHours(problem: TriageableProblem, now: Date): number {
  return Math.max(0, Math.round(hoursBetween(problem.createdAt, now) * 10) / 10);
}

/** True once an unresolved problem has been sitting for a day. */
export function isStale(problem: TriageableProblem, now: Date): boolean {
  if (problem.status === 'RESOLVED' || problem.status === 'REJECTED') return false;
  return problemAgeHours(problem, now) >= STALE_PROBLEM_HOURS;
}

/** Coarse age bands, for the inbox filter. */
export type AgeBucket = 'under2h' | 'under24h' | 'over24h';

export function ageBucketOf(problem: TriageableProblem, now: Date): AgeBucket {
  const hours = problemAgeHours(problem, now);
  if (hours < 2) return 'under2h';
  if (hours < STALE_PROBLEM_HOURS) return 'under24h';
  return 'over24h';
}

/**
 * The inbox order: severity first, then age, oldest first.
 *
 * Severity leads because a blocker halts a job while a low does not, and no
 * amount of waiting turns a low into a blocker. Within a severity the oldest
 * goes first — that is the one closest to becoming the graveyard PDD section 12
 * warns about.
 *
 * Status breaks the remaining ties so an untouched problem outranks one the MD
 * has already read.
 */
export function compareForInbox(a: TriageableProblem, b: TriageableProblem): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;

  const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (byStatus !== 0) return byStatus;

  // Oldest first.
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/** Sorts a copy into inbox order. */
export function sortForInbox<T extends TriageableProblem>(problems: readonly T[]): T[] {
  return [...problems].sort(compareForInbox);
}

/** The counts the nav badge and the header show. */
export interface ProblemCounts {
  open: number;
  acknowledged: number;
  stale: number;
  blockers: number;
}

export function countProblems<T extends TriageableProblem>(
  problems: readonly T[],
  now: Date,
): ProblemCounts {
  return {
    open: problems.filter((p) => p.status === 'OPEN').length,
    acknowledged: problems.filter((p) => p.status === 'ACKNOWLEDGED').length,
    stale: problems.filter((p) => isStale(p, now)).length,
    blockers: problems.filter(
      (p) => p.severity === 'BLOCKER' && (p.status === 'OPEN' || p.status === 'ACKNOWLEDGED'),
    ).length,
  };
}
