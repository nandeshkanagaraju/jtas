import { describe, expect, it } from 'vitest';

import {
  deadlineInForceAt,
  delayHours,
  isMeasurable,
  isOnTime,
  overdueHours,
  percentOf,
  summarise,
  type MeasurableSubtask,
} from '@/lib/domain/metrics';

const DEADLINE = new Date('2026-09-10T12:30:00.000Z'); // 6 PM IST

function subtask(overrides: Partial<MeasurableSubtask> = {}): MeasurableSubtask {
  return { status: 'COMPLETED', deadline: DEADLINE, completedAt: DEADLINE, ...overrides };
}

/** `hours` before (negative) or after (positive) the deadline. */
function at(hours: number): Date {
  return new Date(DEADLINE.getTime() + hours * 3_600_000);
}

describe('isOnTime', () => {
  it('counts work finished before the deadline', () => {
    expect(isOnTime(subtask({ completedAt: at(-3) }))).toBe(true);
  });

  it('counts work finished exactly on the deadline', () => {
    // 6:00:00 PM against a 6 PM deadline is met, not missed.
    expect(isOnTime(subtask({ completedAt: DEADLINE }))).toBe(true);
  });

  it('does not count work finished a minute late', () => {
    expect(isOnTime(subtask({ completedAt: new Date(DEADLINE.getTime() + 60_000) }))).toBe(false);
  });

  it('does not count work that is merely not late yet', () => {
    // Counting open work as on time would make the rate climb as the backlog
    // grows, which is exactly backwards.
    expect(isOnTime(subtask({ status: 'IN_PROGRESS', completedAt: null }))).toBe(false);
    expect(isOnTime(subtask({ status: 'PENDING', completedAt: null }))).toBe(false);
  });

  it('does not count a cancelled subtask, even one with a completedAt', () => {
    expect(isOnTime(subtask({ status: 'CANCELLED', completedAt: at(-5) }))).toBe(false);
  });
});

describe('isMeasurable', () => {
  it.each(['PENDING', 'IN_PROGRESS', 'BLOCKED', 'PROBLEM', 'AWAITING_APPROVAL', 'COMPLETED'])(
    'includes %s',
    (status) => {
      expect(isMeasurable({ status })).toBe(true);
    },
  );

  it('excludes CANCELLED — nobody was late for work that was called off', () => {
    expect(isMeasurable({ status: 'CANCELLED' })).toBe(false);
  });
});

describe('delayHours', () => {
  it('measures lateness in hours', () => {
    expect(delayHours(subtask({ completedAt: at(6) }))).toBe(6);
    expect(delayHours(subtask({ completedAt: at(0.5) }))).toBe(0.5);
  });

  it('is zero for on-time work', () => {
    expect(delayHours(subtask({ completedAt: DEADLINE }))).toBe(0);
  });

  it('is never negative, however early the work finished', () => {
    // Early work must not offset late work in an average, or a department that
    // rushes half its jobs looks like one that hits every deadline.
    expect(delayHours(subtask({ completedAt: at(-40) }))).toBe(0);
  });

  it('is zero for work that is not finished', () => {
    expect(delayHours(subtask({ status: 'IN_PROGRESS', completedAt: null }))).toBe(0);
  });

  it('is zero for a cancelled subtask', () => {
    expect(delayHours(subtask({ status: 'CANCELLED', completedAt: at(20) }))).toBe(0);
  });
});

describe('overdueHours', () => {
  it('measures how overdue open work is right now', () => {
    expect(overdueHours({ deadline: DEADLINE }, at(9))).toBe(9);
  });

  it('is zero before the deadline', () => {
    expect(overdueHours({ deadline: DEADLINE }, at(-2))).toBe(0);
  });
});

describe('deadlineInForceAt — extensions', () => {
  const EXTENDED = at(48);

  it('uses the current deadline when nothing moved after completion', () => {
    expect(deadlineInForceAt(at(50), EXTENDED, []).toISOString()).toBe(EXTENDED.toISOString());
  });

  it('judges an extended subtask against the extended deadline', () => {
    // The department agreed to the new date; that is what it is measured on.
    // The extension itself is reported separately so it cannot hide.
    const extended = subtask({ deadline: EXTENDED, completedAt: at(47) });

    expect(isOnTime(extended)).toBe(true);
    expect(delayHours(extended)).toBe(0);
  });

  it('still counts a subtask late when it misses even the extended deadline', () => {
    const extended = subtask({ deadline: EXTENDED, completedAt: at(60) });

    expect(isOnTime(extended)).toBe(false);
    expect(delayHours(extended)).toBe(12);
  });

  it('rolls back a deadline moved after the work was finished', () => {
    /*
     * `changeDeadline` refuses a closed subtask, so this cannot happen today —
     * and this assertion is what keeps it that way. Without the rollback, a
     * deadline extended after the fact would retroactively turn a late task
     * into an on-time one, which is the one thing an accountability record must
     * never do.
     */
    const completedAt = at(5);
    const movedAfterwards = [{ oldDeadline: DEADLINE, createdAt: at(100) }];

    expect(deadlineInForceAt(completedAt, EXTENDED, movedAfterwards).toISOString()).toBe(
      DEADLINE.toISOString(),
    );

    const late = subtask({ deadline: EXTENDED, completedAt });
    expect(isOnTime(late, movedAfterwards)).toBe(false);
    expect(delayHours(late, movedAfterwards)).toBe(5);
  });

  it('ignores moves that happened before completion', () => {
    const before = [{ oldDeadline: DEADLINE, createdAt: at(-10) }];

    expect(deadlineInForceAt(at(5), EXTENDED, before).toISOString()).toBe(EXTENDED.toISOString());
  });

  it('rolls back through several later moves to the earliest', () => {
    const moves = [
      { oldDeadline: at(24), createdAt: at(80) },
      { oldDeadline: DEADLINE, createdAt: at(60) },
    ];

    expect(deadlineInForceAt(at(5), EXTENDED, moves).toISOString()).toBe(DEADLINE.toISOString());
  });
});

describe('summarise', () => {
  it('reports the counts and the rate', () => {
    const result = summarise([
      subtask({ completedAt: at(-1) }),
      subtask({ completedAt: at(-2) }),
      subtask({ completedAt: at(4) }),
      subtask({ completedAt: at(8) }),
    ]);

    expect(result).toEqual({
      completed: 4,
      onTime: 2,
      late: 2,
      onTimePercent: 50,
      averageDelayHours: 3, // (0 + 0 + 4 + 8) / 4
    });
  });

  it('leaves open work out of the rate entirely', () => {
    const result = summarise([
      subtask({ completedAt: at(-1) }),
      subtask({ status: 'IN_PROGRESS', completedAt: null }),
      subtask({ status: 'PENDING', completedAt: null }),
    ]);

    expect(result.completed).toBe(1);
    expect(result.onTimePercent).toBe(100);
  });

  it('leaves cancelled work out of the rate entirely', () => {
    const result = summarise([
      subtask({ completedAt: at(-1) }),
      subtask({ status: 'CANCELLED', completedAt: at(30) }),
    ]);

    expect(result.completed).toBe(1);
    expect(result.late).toBe(0);
    expect(result.onTimePercent).toBe(100);
  });

  it('reports null rather than 0% when nothing has been completed', () => {
    // A department that has finished nothing has no record. Calling it 0% would
    // rank it below one that is genuinely failing.
    const result = summarise([subtask({ status: 'PENDING', completedAt: null })]);

    expect(result.onTimePercent).toBeNull();
    expect(result.averageDelayHours).toBe(0);
  });

  it('reports null for an empty set', () => {
    expect(summarise([]).onTimePercent).toBeNull();
  });

  it('rounds to one decimal place', () => {
    const result = summarise([
      subtask({ completedAt: at(-1) }),
      subtask({ completedAt: at(-1) }),
      subtask({ completedAt: at(5) }),
    ]);

    expect(result.onTimePercent).toBe(66.7);
  });

  it('applies per-subtask deadline moves when given them', () => {
    const moves = new Map([['a', [{ oldDeadline: DEADLINE, createdAt: at(100) }]]]);
    const rows = [subtask({ deadline: at(48), completedAt: at(5) })];

    expect(summarise(rows, moves, () => 'a').onTimePercent).toBe(0);
    expect(summarise(rows).onTimePercent).toBe(100);
  });
});

describe('percentOf', () => {
  it('matches summarise, so SQL-side counts agree with row-side ones', () => {
    expect(percentOf(2, 4)).toBe(50);
    expect(percentOf(2, 3)).toBe(66.7);
    expect(percentOf(0, 5)).toBe(0);
  });

  it('is null when there is nothing to measure', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(3, 0)).toBeNull();
  });
});
