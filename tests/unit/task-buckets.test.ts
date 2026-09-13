import type { SubtaskStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  BUCKET_ORDER,
  bucketFor,
  groupTasks,
  hoursRemaining,
  isOverdue,
  istDayBoundaries,
  summarise,
  type BucketableTask,
} from '@/lib/domain/task-buckets';
import { fromISTInput } from '@/lib/utils/time';

/** 13 Sep 2026, 14:00 IST — mid-afternoon on the shop floor. */
const NOW = fromISTInput('2026-09-13T14:00');

function task(
  status: SubtaskStatus,
  deadline: string,
  completedAt: string | null = null,
): BucketableTask {
  return {
    status,
    deadline: fromISTInput(deadline),
    completedAt: completedAt ? fromISTInput(completedAt) : null,
  };
}

describe('isOverdue', () => {
  it('is true for an active task past its deadline', () => {
    expect(isOverdue(task('IN_PROGRESS', '2026-09-13T09:00'), NOW)).toBe(true);
  });

  it('is false once completed or cancelled, however late', () => {
    expect(isOverdue(task('COMPLETED', '2020-01-01T09:00'), NOW)).toBe(false);
    expect(isOverdue(task('CANCELLED', '2020-01-01T09:00'), NOW)).toBe(false);
  });

  it('is false at exactly the deadline and true a millisecond later', () => {
    const exact: BucketableTask = { status: 'PENDING', deadline: NOW, completedAt: null };
    expect(isOverdue(exact, NOW)).toBe(false);
    expect(isOverdue({ ...exact, deadline: new Date(NOW.getTime() - 1) }, NOW)).toBe(true);
  });
});

describe('bucketFor — deadline buckets use IST calendar days', () => {
  it('puts a passed deadline in overdue', () => {
    expect(bucketFor(task('IN_PROGRESS', '2026-09-13T09:00'), NOW)).toBe('overdue');
  });

  it('puts the rest of today in dueToday, right up to IST midnight', () => {
    expect(bucketFor(task('PENDING', '2026-09-13T18:00'), NOW)).toBe('dueToday');
    // 23:59 IST is still today…
    expect(bucketFor(task('PENDING', '2026-09-13T23:59'), NOW)).toBe('dueToday');
    // …and 00:01 the next day is not.
    expect(bucketFor(task('PENDING', '2026-09-14T00:01'), NOW)).toBe('dueThisWeek');
  });

  it('does not let the UTC date decide the day', () => {
    // 21:00 IST on the 13th is 15:30 UTC on the 13th — same UTC day. But
    // 02:00 IST on the 14th is 20:30 UTC on the *13th*, and must not read as
    // today just because UTC still says the 13th.
    const lateEvening = fromISTInput('2026-09-13T21:00');
    expect(bucketFor({ status: 'PENDING', deadline: lateEvening, completedAt: null }, NOW)).toBe(
      'dueToday',
    );
    const earlyTomorrow = fromISTInput('2026-09-14T02:00');
    expect(bucketFor({ status: 'PENDING', deadline: earlyTomorrow, completedAt: null }, NOW)).toBe(
      'dueThisWeek',
    );
  });

  it('covers the next seven IST days in dueThisWeek', () => {
    expect(bucketFor(task('PENDING', '2026-09-16T10:00'), NOW)).toBe('dueThisWeek');
    expect(bucketFor(task('PENDING', '2026-09-19T23:00'), NOW)).toBe('dueThisWeek');
  });

  it('puts anything beyond that in later, rather than nowhere', () => {
    // Without this bucket a task three weeks out would vanish from the screen.
    expect(bucketFor(task('PENDING', '2026-10-05T10:00'), NOW)).toBe('later');
  });
});

describe('bucketFor — status buckets take precedence', () => {
  it('puts a BLOCKED task in blocked even when it is overdue', () => {
    // Surfacing it under "overdue" would ask the member to do work the system
    // itself is preventing.
    expect(bucketFor(task('BLOCKED', '2026-09-10T09:00'), NOW)).toBe('blocked');
  });

  it('puts an AWAITING_APPROVAL task in its own bucket, not overdue', () => {
    expect(bucketFor(task('AWAITING_APPROVAL', '2026-09-10T09:00'), NOW)).toBe('awaitingApproval');
  });

  it('keeps a PROBLEM task in its deadline bucket — it is still the member’s', () => {
    expect(bucketFor(task('PROBLEM', '2026-09-10T09:00'), NOW)).toBe('overdue');
    expect(bucketFor(task('PROBLEM', '2026-09-13T18:00'), NOW)).toBe('dueToday');
  });
});

describe('bucketFor — finished and paused work', () => {
  it('shows work completed in the last seven days', () => {
    expect(bucketFor(task('COMPLETED', '2026-09-12T10:00', '2026-09-12T11:00'), NOW)).toBe(
      'recentlyCompleted',
    );
    expect(bucketFor(task('COMPLETED', '2026-09-07T10:00', '2026-09-07T10:00'), NOW)).toBe(
      'recentlyCompleted',
    );
  });

  it('drops work completed longer ago', () => {
    expect(bucketFor(task('COMPLETED', '2026-08-01T10:00', '2026-08-01T10:00'), NOW)).toBeNull();
  });

  it('drops a completed task with no completion stamp rather than guessing', () => {
    expect(bucketFor(task('COMPLETED', '2026-09-12T10:00', null), NOW)).toBeNull();
  });

  it('hides cancelled and on-hold work — neither is anybody’s to do', () => {
    expect(bucketFor(task('CANCELLED', '2026-09-13T18:00'), NOW)).toBeNull();
    expect(bucketFor(task('ON_HOLD', '2026-09-13T18:00'), NOW)).toBeNull();
  });
});

describe('groupTasks', () => {
  it('sorts each bucket by deadline, nearest first', () => {
    const tasks = [
      task('PENDING', '2026-09-13T20:00'),
      task('PENDING', '2026-09-13T15:00'),
      task('PENDING', '2026-09-13T17:00'),
    ];

    const grouped = groupTasks(tasks, NOW);
    expect(grouped.dueToday.map((t) => t.deadline.toISOString())).toEqual([
      fromISTInput('2026-09-13T15:00').toISOString(),
      fromISTInput('2026-09-13T17:00').toISOString(),
      fromISTInput('2026-09-13T20:00').toISOString(),
    ]);
  });

  it('sorts recently completed by completion time, newest first', () => {
    const tasks = [
      task('COMPLETED', '2026-09-08T10:00', '2026-09-08T10:00'),
      task('COMPLETED', '2026-09-12T10:00', '2026-09-12T10:00'),
    ];

    const grouped = groupTasks(tasks, NOW);
    expect(grouped.recentlyCompleted[0].completedAt?.toISOString()).toBe(
      fromISTInput('2026-09-12T10:00').toISOString(),
    );
  });

  it('returns every bucket, empty ones included, so the UI needs no guards', () => {
    const grouped = groupTasks([], NOW);
    for (const name of BUCKET_ORDER) {
      expect(grouped[name], name).toEqual([]);
    }
  });

  it('places each task in exactly one bucket', () => {
    const tasks = [
      task('IN_PROGRESS', '2026-09-10T09:00'),
      task('PENDING', '2026-09-13T18:00'),
      task('PENDING', '2026-09-16T10:00'),
      task('BLOCKED', '2026-09-14T10:00'),
      task('AWAITING_APPROVAL', '2026-09-14T10:00'),
      task('PENDING', '2026-10-05T10:00'),
      task('COMPLETED', '2026-09-12T10:00', '2026-09-12T10:00'),
      task('CANCELLED', '2026-09-13T18:00'),
    ];

    const grouped = groupTasks(tasks, NOW);
    const total = BUCKET_ORDER.reduce((sum, name) => sum + grouped[name].length, 0);

    // Seven bucketed, the cancelled one dropped.
    expect(total).toBe(7);
    expect(grouped.overdue).toHaveLength(1);
    expect(grouped.dueToday).toHaveLength(1);
    expect(grouped.dueThisWeek).toHaveLength(1);
    expect(grouped.blocked).toHaveLength(1);
    expect(grouped.awaitingApproval).toHaveLength(1);
    expect(grouped.later).toHaveLength(1);
    expect(grouped.recentlyCompleted).toHaveLength(1);
  });
});

describe('hoursRemaining', () => {
  it('is positive before the deadline and negative after it', () => {
    expect(hoursRemaining(task('PENDING', '2026-09-13T18:00'), NOW)).toBe(4);
    expect(hoursRemaining(task('PENDING', '2026-09-13T09:00'), NOW)).toBe(-5);
  });

  it('rounds to one decimal so the UI is not noisy', () => {
    expect(hoursRemaining(task('PENDING', '2026-09-13T14:07'), NOW)).toBe(0.1);
  });
});

describe('summarise', () => {
  const withProblem = (t: BucketableTask, hasOpenProblem: boolean) => ({ ...t, hasOpenProblem });

  it('counts the three numbers the sticky strip shows', () => {
    const grouped = groupTasks(
      [
        withProblem(task('IN_PROGRESS', '2026-09-10T09:00'), true),
        withProblem(task('PENDING', '2026-09-13T18:00'), false),
        withProblem(task('PENDING', '2026-09-13T20:00'), false),
        withProblem(task('PROBLEM', '2026-09-16T10:00'), true),
      ],
      NOW,
    );

    expect(summarise(grouped)).toMatchObject({ overdue: 1, dueToday: 2, openProblems: 2 });
  });

  it('does not count problems on work that is already finished', () => {
    const grouped = groupTasks(
      [withProblem(task('COMPLETED', '2026-09-12T10:00', '2026-09-12T10:00'), true)],
      NOW,
    );
    expect(summarise(grouped).openProblems).toBe(0);
  });
});

describe('istDayBoundaries', () => {
  it('spans one IST calendar day', () => {
    const { startOfToday, endOfToday } = istDayBoundaries(NOW);
    expect(endOfToday.getTime() - startOfToday.getTime()).toBe(24 * 60 * 60 * 1000);
    // IST midnight is 18:30 UTC the previous day.
    expect(startOfToday.toISOString()).toBe('2026-09-12T18:30:00.000Z');
  });
});
