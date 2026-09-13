import type { ProblemSeverity, ProblemStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  STALE_PROBLEM_HOURS,
  ageBucketOf,
  compareForInbox,
  countProblems,
  isStale,
  problemAgeHours,
  sortForInbox,
  type TriageableProblem,
} from '@/lib/domain/problem-triage';

const NOW = new Date('2026-09-13T14:00:00Z');

function problem(
  severity: ProblemSeverity,
  hoursAgo: number,
  status: ProblemStatus = 'OPEN',
): TriageableProblem {
  return { severity, status, createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000) };
}

describe('problemAgeHours', () => {
  it('counts hours since it was raised', () => {
    expect(problemAgeHours(problem('HIGH', 5), NOW)).toBe(5);
    expect(problemAgeHours(problem('HIGH', 0.5), NOW)).toBe(0.5);
  });

  it('never goes negative on a clock skew', () => {
    const future: TriageableProblem = {
      severity: 'HIGH',
      status: 'OPEN',
      createdAt: new Date(NOW.getTime() + 60_000),
    };
    expect(problemAgeHours(future, NOW)).toBe(0);
  });
});

describe('isStale', () => {
  it('flags an unresolved problem at 24 hours, not before', () => {
    expect(isStale(problem('HIGH', 23.9), NOW)).toBe(false);
    expect(isStale(problem('HIGH', STALE_PROBLEM_HOURS), NOW)).toBe(true);
    expect(isStale(problem('HIGH', 48), NOW)).toBe(true);
  });

  it('flags an acknowledged problem too — reading it is not deciding it', () => {
    expect(isStale(problem('HIGH', 30, 'ACKNOWLEDGED'), NOW)).toBe(true);
  });

  it('never flags a closed problem, however old', () => {
    expect(isStale(problem('BLOCKER', 200, 'RESOLVED'), NOW)).toBe(false);
    expect(isStale(problem('BLOCKER', 200, 'REJECTED'), NOW)).toBe(false);
  });
});

describe('ageBucketOf', () => {
  it('bands by the two thresholds the MD cares about', () => {
    expect(ageBucketOf(problem('HIGH', 1), NOW)).toBe('under2h');
    expect(ageBucketOf(problem('HIGH', 5), NOW)).toBe('under24h');
    expect(ageBucketOf(problem('HIGH', 25), NOW)).toBe('over24h');
  });

  it('uses the two-hour success metric as the first boundary', () => {
    expect(ageBucketOf(problem('HIGH', 1.9), NOW)).toBe('under2h');
    expect(ageBucketOf(problem('HIGH', 2), NOW)).toBe('under24h');
  });
});

describe('compareForInbox', () => {
  it('puts a blocker above everything, however new', () => {
    expect(compareForInbox(problem('BLOCKER', 0.1), problem('LOW', 100))).toBeLessThan(0);
    expect(compareForInbox(problem('BLOCKER', 0.1), problem('HIGH', 100))).toBeLessThan(0);
  });

  it('orders severities blocker, high, medium, low', () => {
    const sorted = sortForInbox([
      problem('LOW', 1),
      problem('HIGH', 1),
      problem('BLOCKER', 1),
      problem('MEDIUM', 1),
    ]);
    expect(sorted.map((p) => p.severity)).toEqual(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('puts the oldest first within a severity', () => {
    const sorted = sortForInbox([problem('HIGH', 1), problem('HIGH', 10), problem('HIGH', 5)]);
    expect(sorted.map((p) => problemAgeHours(p, NOW))).toEqual([10, 5, 1]);
  });

  it('puts an untouched problem above one already acknowledged', () => {
    const sorted = sortForInbox([problem('HIGH', 10, 'ACKNOWLEDGED'), problem('HIGH', 1, 'OPEN')]);
    expect(sorted[0].status).toBe('OPEN');
  });

  it('is a stable total order — sorting twice changes nothing', () => {
    const input = [
      problem('MEDIUM', 3),
      problem('BLOCKER', 30, 'ACKNOWLEDGED'),
      problem('HIGH', 1),
      problem('LOW', 50),
      problem('HIGH', 26),
    ];
    expect(sortForInbox(sortForInbox(input))).toEqual(sortForInbox(input));
  });

  it('does not mutate its input', () => {
    const input = [problem('LOW', 1), problem('BLOCKER', 2)];
    const before = [...input];
    sortForInbox(input);
    expect(input).toEqual(before);
  });
});

describe('countProblems', () => {
  it('counts what the nav badge and the header show', () => {
    const counts = countProblems(
      [
        problem('BLOCKER', 30),
        problem('HIGH', 1, 'ACKNOWLEDGED'),
        problem('LOW', 2),
        problem('BLOCKER', 100, 'RESOLVED'),
      ],
      NOW,
    );

    expect(counts).toEqual({ open: 2, acknowledged: 1, stale: 1, blockers: 1 });
  });

  it('counts an acknowledged blocker as a blocker — it is still unsolved', () => {
    expect(countProblems([problem('BLOCKER', 1, 'ACKNOWLEDGED')], NOW).blockers).toBe(1);
  });
});
