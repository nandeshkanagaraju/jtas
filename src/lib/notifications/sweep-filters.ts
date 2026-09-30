/**
 * The predicates the overdue sweep and the reminder scheduler share.
 *
 * They live here so the diagnostic command and the sweeper cannot drift apart.
 * A check that exists only in the query is exactly how a subtask can be overdue
 * on screen and invisible to the mail, with nothing written down to say why.
 */
import type { JobStatus, SubtaskStatus } from '@prisma/client';

/**
 * Subtask states that are still chaseable.
 *
 * `PROBLEM` is absent on purpose: a member who has reported a blocker is not
 * nagged. `ON_HOLD`, `COMPLETED` and `CANCELLED` are absent because there is
 * nothing to chase.
 */
export const CHASEABLE_SUBTASK_STATUSES: readonly SubtaskStatus[] = [
  'PENDING',
  'IN_PROGRESS',
  'BLOCKED',
  'AWAITING_APPROVAL',
];

/** Job states whose timers are paused or finished, so overdue chasing stops. */
export const EXCLUDED_OVERDUE_JOB_STATUSES: readonly JobStatus[] = [
  'ON_HOLD',
  'CANCELLED',
  'DRAFT',
  'COMPLETED',
];

export interface FilterVerdict {
  /** Short name of the check, stable enough to grep for. */
  name: string;
  passed: boolean;
  /** What was observed, including the value that failed. */
  detail: string;
}

/**
 * Why a reminder row is not queued when its moment is already past.
 *
 * Written onto the notification as `lastError` and shown in the inbox. The
 * previous behaviour was to return without inserting anything, which is
 * indistinguishable from "the sweeper has not got there yet".
 */
export function skippedReminderReason(input: {
  reminderLeadMinutes: number;
  remindAt: Date;
  savedAt: Date;
}): string {
  return (
    `Not scheduled: the reminder lead is ${input.reminderLeadMinutes} minutes, ` +
    `so this reminder was due at ${input.remindAt.toISOString()}. ` +
    `That moment had already passed when the subtask was saved at ${input.savedAt.toISOString()}, ` +
    `so no reminder email will be sent for this deadline. ` +
    `Use a shorter lead, or a deadline further out, if you still want one.`
  );
}

export function overdueFilterVerdicts(input: {
  now: Date;
  deadline: Date;
  subtaskStatus: SubtaskStatus;
  jobStatus: JobStatus;
  jobIsDemo: boolean;
  escalationCount: number;
  maxEscalations: number;
  lastEscalatedAt: Date | null;
  intervalMinutes: number;
}): FilterVerdict[] {
  /*
   * escalateOverdue writes the same check as `lastEscalatedAt < now - interval`,
   * so the column can be compared in SQL. That bound is four hours *before*
   * the last chase when read as a clock time. The next chase is allowed once
   * `now` is strictly after lastEscalatedAt + interval — equality waits, because
   * the query uses `<`, not `<=`.
   */
  const nextAllowedAt =
    input.lastEscalatedAt === null
      ? null
      : new Date(input.lastEscalatedAt.getTime() + input.intervalMinutes * 60_000);
  const escalationDue = nextAllowedAt === null || input.now.getTime() > nextAllowedAt.getTime();

  return [
    {
      name: 'deadline has passed',
      passed: input.deadline.getTime() < input.now.getTime(),
      detail: `deadline ${input.deadline.toISOString()}, sweep time ${input.now.toISOString()}`,
    },
    {
      name: 'subtask status is chaseable',
      passed: CHASEABLE_SUBTASK_STATUSES.includes(input.subtaskStatus),
      detail: `status ${input.subtaskStatus}; chaseable: ${CHASEABLE_SUBTASK_STATUSES.join(', ')}`,
    },
    {
      name: 'job status is still live',
      passed: !EXCLUDED_OVERDUE_JOB_STATUSES.includes(input.jobStatus),
      detail: `job status ${input.jobStatus}; excluded: ${EXCLUDED_OVERDUE_JOB_STATUSES.join(', ')}`,
    },
    {
      name: 'job is not demonstration data',
      passed: !input.jobIsDemo,
      detail: input.jobIsDemo
        ? 'job.isDemo is true, so the sweeper never selects it'
        : 'job.isDemo is false',
    },
    {
      name: 'escalation count is under the ceiling',
      passed: input.escalationCount < input.maxEscalations,
      detail: `escalationCount ${input.escalationCount}, max ${input.maxEscalations}`,
    },
    {
      name: 'enough time since the last escalation',
      passed: escalationDue,
      detail:
        input.lastEscalatedAt && nextAllowedAt
          ? `last escalated ${input.lastEscalatedAt.toISOString()}, next allowed after ${nextAllowedAt.toISOString()} (every ${input.intervalMinutes} minutes)`
          : 'never escalated',
    },
  ];
}
