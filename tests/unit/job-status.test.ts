import type { JobStatus, SubtaskStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import {
  AT_RISK_WINDOW_HOURS,
  deriveJobStatus,
  isSubtaskOverdue,
  jobProgress,
  type SubtaskSnapshot,
} from '@/lib/domain/job-status';

const NOW = new Date('2026-09-13T10:00:00Z');
const FAR_FUTURE = new Date('2026-12-31T12:00:00Z');

function subtask(status: SubtaskStatus, deadline: Date = FAR_FUTURE): SubtaskSnapshot {
  return { status, deadline };
}

function derive(
  subtasks: SubtaskSnapshot[],
  overrides: { currentStatus?: JobStatus; overallDeadline?: Date; now?: Date } = {},
): JobStatus {
  return deriveJobStatus({
    currentStatus: overrides.currentStatus ?? 'IN_PROGRESS',
    overallDeadline: overrides.overallDeadline ?? FAR_FUTURE,
    subtasks,
    now: overrides.now ?? NOW,
  });
}

// ---------------------------------------------------------------------------
// isSubtaskOverdue — PDD improvement I-08
// ---------------------------------------------------------------------------

describe('isSubtaskOverdue', () => {
  const past = new Date('2026-09-13T09:00:00Z');
  const future = new Date('2026-09-13T11:00:00Z');

  it('is true for an active subtask past its deadline', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL'] as const) {
      expect(isSubtaskOverdue(subtask(status, past), NOW), status).toBe(true);
    }
  });

  it('is false once the subtask is completed or cancelled', () => {
    expect(isSubtaskOverdue(subtask('COMPLETED', past), NOW)).toBe(false);
    expect(isSubtaskOverdue(subtask('CANCELLED', past), NOW)).toBe(false);
  });

  it('is false before the deadline', () => {
    expect(isSubtaskOverdue(subtask('IN_PROGRESS', future), NOW)).toBe(false);
  });

  it('is false at exactly the deadline, and true one millisecond later', () => {
    // The boundary decides whether the sweeper mails at the stroke of the hour.
    expect(isSubtaskOverdue(subtask('IN_PROGRESS', NOW), NOW)).toBe(false);
    expect(isSubtaskOverdue(subtask('IN_PROGRESS', new Date(NOW.getTime() - 1)), NOW)).toBe(true);
  });

  it('counts a subtask in PROBLEM as overdue if its deadline has passed', () => {
    // It is still overdue as a fact; what changes is that the sweeper does not
    // nag the member about it (improvement I-05).
    expect(isSubtaskOverdue(subtask('PROBLEM', past), NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deriveJobStatus — SDD section 4.2
// ---------------------------------------------------------------------------

describe('deriveJobStatus — manual states are never overwritten', () => {
  it('leaves DRAFT alone, whatever the subtasks say', () => {
    expect(derive([subtask('COMPLETED')], { currentStatus: 'DRAFT' })).toBe('DRAFT');
    expect(
      derive([subtask('IN_PROGRESS', new Date('2020-01-01T00:00:00Z'))], {
        currentStatus: 'DRAFT',
      }),
    ).toBe('DRAFT');
  });

  it('leaves ON_HOLD alone — a held job pauses its timers (FR-14)', () => {
    // Without this, an overdue subtask would flip a deliberately paused job to
    // DELAYED and the hold would achieve nothing.
    expect(
      derive([subtask('IN_PROGRESS', new Date('2020-01-01T00:00:00Z'))], {
        currentStatus: 'ON_HOLD',
      }),
    ).toBe('ON_HOLD');
  });

  it('leaves CANCELLED alone — it is terminal', () => {
    expect(derive([subtask('IN_PROGRESS')], { currentStatus: 'CANCELLED' })).toBe('CANCELLED');
  });
});

describe('deriveJobStatus — the ladder', () => {
  it('is CANCELLED when every subtask is cancelled', () => {
    expect(derive([subtask('CANCELLED'), subtask('CANCELLED')])).toBe('CANCELLED');
  });

  it('is not CANCELLED when only some subtasks are', () => {
    // The alternative reading of SDD 4.2 line 1 would kill a live order the
    // moment one department's task was dropped.
    expect(derive([subtask('CANCELLED'), subtask('IN_PROGRESS')])).toBe('IN_PROGRESS');
  });

  it('is COMPLETED when everything is completed or cancelled', () => {
    expect(derive([subtask('COMPLETED'), subtask('COMPLETED')])).toBe('COMPLETED');
    expect(derive([subtask('COMPLETED'), subtask('CANCELLED')])).toBe('COMPLETED');
  });

  it('is DELAYED when any subtask is overdue', () => {
    const overdue = subtask('IN_PROGRESS', new Date('2026-09-13T09:00:00Z'));
    expect(derive([subtask('COMPLETED'), overdue])).toBe('DELAYED');
  });

  it('prefers DELAYED over AT_RISK when both apply', () => {
    // The delay is the fact the MD has to act on first.
    const overdue = subtask('IN_PROGRESS', new Date('2026-09-13T09:00:00Z'));
    expect(derive([overdue, subtask('PROBLEM')])).toBe('DELAYED');
  });

  it('is AT_RISK when a subtask carries an open problem', () => {
    expect(derive([subtask('PROBLEM'), subtask('IN_PROGRESS')])).toBe('AT_RISK');
  });

  it('is AT_RISK inside the 24-hour window before the overall deadline', () => {
    const deadline = new Date('2026-09-14T00:00:00Z'); // 14 h after NOW
    expect(derive([subtask('IN_PROGRESS')], { overallDeadline: deadline })).toBe('AT_RISK');
  });

  it('is IN_PROGRESS just outside that window, and AT_RISK just inside it', () => {
    const boundary = new Date(NOW.getTime() + AT_RISK_WINDOW_HOURS * 3_600_000);

    expect(
      derive([subtask('IN_PROGRESS')], { overallDeadline: new Date(boundary.getTime() + 1000) }),
    ).toBe('IN_PROGRESS');

    expect(
      derive([subtask('IN_PROGRESS')], { overallDeadline: new Date(boundary.getTime() - 1000) }),
    ).toBe('AT_RISK');
  });

  it('does not report AT_RISK for a job that is already finished', () => {
    // All complete wins over the deadline window, so a job delivered on the
    // last morning does not sit on the dashboard as at risk.
    const deadline = new Date('2026-09-13T12:00:00Z');
    expect(derive([subtask('COMPLETED')], { overallDeadline: deadline })).toBe('COMPLETED');
  });

  it('is IN_PROGRESS in the ordinary case', () => {
    expect(derive([subtask('PENDING'), subtask('IN_PROGRESS'), subtask('COMPLETED')])).toBe(
      'IN_PROGRESS',
    );
  });

  it('falls back to IN_PROGRESS with no subtasks', () => {
    // Unreachable after publish, which requires at least one subtask.
    expect(derive([])).toBe('IN_PROGRESS');
  });

  it('recovers from DELAYED once the overdue subtask completes', () => {
    const overdue = subtask('IN_PROGRESS', new Date('2026-09-13T09:00:00Z'));
    expect(derive([overdue])).toBe('DELAYED');

    const done = subtask('COMPLETED', new Date('2026-09-13T09:00:00Z'));
    expect(derive([done], { currentStatus: 'DELAYED' })).toBe('COMPLETED');
  });

  it('recovers from AT_RISK once the problem is resolved', () => {
    expect(derive([subtask('PROBLEM')], { currentStatus: 'AT_RISK' })).toBe('AT_RISK');
    expect(derive([subtask('IN_PROGRESS')], { currentStatus: 'AT_RISK' })).toBe('IN_PROGRESS');
  });

  it('covers every derived status across the ladder', () => {
    const reached = new Set<JobStatus>([
      derive([subtask('CANCELLED')]),
      derive([subtask('COMPLETED')]),
      derive([subtask('IN_PROGRESS', new Date('2020-01-01T00:00:00Z'))]),
      derive([subtask('PROBLEM')]),
      derive([subtask('IN_PROGRESS')]),
    ]);

    expect(reached).toEqual(
      new Set<JobStatus>(['CANCELLED', 'COMPLETED', 'DELAYED', 'AT_RISK', 'IN_PROGRESS']),
    );
  });
});

// ---------------------------------------------------------------------------
// jobProgress
// ---------------------------------------------------------------------------

describe('jobProgress', () => {
  it('counts only completed subtasks', () => {
    expect(jobProgress([subtask('COMPLETED'), subtask('IN_PROGRESS'), subtask('PENDING')])).toEqual(
      { completed: 1, total: 3, percent: 33 },
    );
  });

  it('treats a cancelled subtask as not completed but still part of the total', () => {
    expect(jobProgress([subtask('COMPLETED'), subtask('CANCELLED')])).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });

  it('is zero rather than NaN with no subtasks', () => {
    expect(jobProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it('reaches 100 only when everything is completed', () => {
    expect(jobProgress([subtask('COMPLETED'), subtask('COMPLETED')]).percent).toBe(100);
  });
});
