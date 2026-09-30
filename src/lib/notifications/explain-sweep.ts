/**
 * What the next sweep would do to one subtask, without doing it.
 *
 * The sweeper's filters fail closed and, until a row exists, silently. This
 * walks the same checks — overdue selection, allowlist, daily cap, working
 * hours, demonstration data, status — and prints the verdict. It never calls
 * a channel and never writes a row.
 */
import type { JobStatus, NotifType, SubtaskStatus } from '@prisma/client';

import { formatIST } from '@/lib/utils/time';

import { isAllowedRecipient, suppressionReason } from './mail-guard';
import { overdueFilterVerdicts, skippedReminderReason, type FilterVerdict } from './sweep-filters';
import { isSuppressible, nextWorkingSlot, type WorkingHoursConfig } from './working-hours';

export interface ExplainNotification {
  type: NotifType | string;
  status: string;
  channel: string;
  scheduledFor: Date;
  attemptCount: number;
  lastError: string | null;
  recipientEmail: string;
}

export interface ExplainCommander {
  email: string;
  isDemo: boolean;
  isActive: boolean;
}

export interface ExplainSweepInput {
  now: Date;
  subtask: {
    id: string;
    title: string;
    status: SubtaskStatus;
    deadline: Date;
    reminderLeadMinutes: number;
    escalationCount: number;
    lastEscalatedAt: Date | null;
  };
  job: {
    jobCode: string;
    title: string;
    status: JobStatus;
    isDemo: boolean;
  };
  assignee: {
    name: string;
    email: string;
    isActive: boolean;
    isDemo: boolean;
  };
  notifications: ExplainNotification[];
  commanders: ExplainCommander[];
  heartbeatAt: Date | null;
  schedulerIntervalMinutes: number;
  staleAfterMinutes: number;
  escalation: { intervalMinutes: number; maxCount: number };
  workingHours: WorkingHoursConfig;
  suppressOutsideHours: boolean;
  allowlist: readonly string[];
  quota: { sentToday: number; cap: number; exhausted: boolean };
  provider: string;
  senderEmail: string;
}

function line(verdict: FilterVerdict): string {
  return `  ${verdict.passed ? 'PASS' : 'FAIL'}  ${verdict.name} — ${verdict.detail}`;
}

function mailFate(email: string, input: ExplainSweepInput): string {
  if (!isAllowedRecipient(email, input.allowlist)) {
    return `SUPPRESS without sending. ${suppressionReason(email)}`;
  }
  if (input.quota.exhausted) {
    return `leave PENDING. Daily cap is ${input.quota.cap} and ${input.quota.sentToday} have already been sent today.`;
  }
  return `SEND via ${input.provider} from ${input.senderEmail}.`;
}

function dispatchFate(row: ExplainNotification, input: ExplainSweepInput): string {
  if (row.status !== 'PENDING') {
    const reason = row.lastError ? ` ${row.lastError}` : '';
    return `already ${row.status}, attempts ${row.attemptCount}.${reason}`;
  }

  if (row.scheduledFor.getTime() > input.now.getTime()) {
    return `not due yet (scheduled ${formatIST(row.scheduledFor)}). The sweep would leave it.`;
  }

  if (input.suppressOutsideHours && isSuppressible(row.type)) {
    const slot = nextWorkingSlot(input.now, input.workingHours);
    if (slot.getTime() > input.now.getTime()) {
      return `defer to ${formatIST(slot)}. ${row.type} waits for working hours; nothing is sent on this pass.`;
    }
  }

  if (row.channel === 'EMAIL') return mailFate(row.recipientEmail, input);
  return `deliver on the ${row.channel} channel. The mail guards do not apply.`;
}

/** Plain-text report. Stable enough to read in a terminal and to assert on. */
export function explainSweep(input: ExplainSweepInput): string {
  const overdue = overdueFilterVerdicts({
    now: input.now,
    deadline: input.subtask.deadline,
    subtaskStatus: input.subtask.status,
    jobStatus: input.job.status,
    jobIsDemo: input.job.isDemo,
    escalationCount: input.subtask.escalationCount,
    maxEscalations: input.escalation.maxCount,
    lastEscalatedAt: input.subtask.lastEscalatedAt,
    intervalMinutes: input.escalation.intervalMinutes,
  });
  const overdueMatches = overdue.every((check) => check.passed);

  const heartbeatAgeSeconds = input.heartbeatAt
    ? Math.round((input.now.getTime() - input.heartbeatAt.getTime()) / 1000)
    : null;
  const workerStale =
    heartbeatAgeSeconds === null || heartbeatAgeSeconds > input.staleAfterMinutes * 60;

  const remindAt = new Date(
    input.subtask.deadline.getTime() - input.subtask.reminderLeadMinutes * 60_000,
  );
  const reminderRows = input.notifications.filter((row) => row.type === 'DEADLINE_REMINDER');

  const lines: string[] = [
    `Subtask ${input.subtask.id}`,
    `  ${input.subtask.title}`,
    `  status ${input.subtask.status}, deadline ${formatIST(input.subtask.deadline)}, escalation ${input.subtask.escalationCount}`,
    `Job ${input.job.jobCode} — ${input.job.title}`,
    `  status ${input.job.status}, isDemo ${input.job.isDemo}`,
    `Assignee ${input.assignee.name} <${input.assignee.email}>`,
    `  active ${input.assignee.isActive}, isDemo ${input.assignee.isDemo}`,
    '',
    'Worker',
    heartbeatAgeSeconds === null
      ? '  no scheduler.heartbeat has ever been written'
      : `  last sweep ${input.heartbeatAt?.toISOString()} (${heartbeatAgeSeconds}s ago)`,
    workerStale
      ? `  FAIL  the worker is not sweeping. /api/health reports this as schedulerHeartbeatAgeSeconds and returns 503 once it exceeds ${input.staleAfterMinutes} minutes. Nothing below is dispatched until a worker process is running.`
      : `  PASS  heartbeat is fresh. /api/health field schedulerHeartbeatAgeSeconds is under ${input.staleAfterMinutes} minutes. Interval ${input.schedulerIntervalMinutes} minutes.`,
    '',
    `Mail provider: ${input.provider}, sender ${input.senderEmail}`,
    input.allowlist.length === 0
      ? '  allowlist is empty, so every recipient is permitted'
      : `  allowlist: ${input.allowlist.join(', ')}`,
    `  daily cap ${input.quota.cap}, sent today ${input.quota.sentToday}, exhausted ${input.quota.exhausted}`,
    `  working-hours suppression ${input.suppressOutsideHours ? 'on' : 'off'}`,
    '',
    'Overdue selection (same checks as escalateOverdue)',
    ...overdue.map(line),
  ];

  if (!overdueMatches) {
    const failed = overdue.filter((check) => !check.passed).map((check) => check.name);
    lines.push(
      `  The next sweep would NOT queue an overdue mail. Excluded by: ${failed.join('; ')}.`,
    );
  } else {
    lines.push(
      '  The next sweep would queue overdue mail (it sends on the sweep after that, because dispatch runs before escalation).',
    );
    lines.push(
      `  OVERDUE_MEMBER to ${input.assignee.email}: ${
        input.assignee.isDemo
          ? 'no row. Demonstration accounts are dropped before insert, so nothing is recorded.'
          : input.assignee.isActive
            ? mailFate(input.assignee.email, input)
            : 'SUPPRESS. The recipient is no longer active.'
      }`,
    );
    if (input.commanders.length === 0) {
      lines.push('  OVERDUE_MD: no active MD or deputy, so no row.');
    }
    for (const commander of input.commanders) {
      lines.push(
        `  OVERDUE_MD to ${commander.email}: ${
          commander.isDemo
            ? 'no row. Demonstration accounts are dropped before insert.'
            : !commander.isActive
              ? 'SUPPRESS. The recipient is no longer active.'
              : mailFate(commander.email, input)
        }`,
      );
    }
  }

  lines.push('', 'Reminder');
  if (reminderRows.length === 0) {
    if (remindAt.getTime() <= input.now.getTime()) {
      lines.push(
        `  no row exists. The reminder lead is ${input.subtask.reminderLeadMinutes} minutes, so the reminder was due at ${remindAt.toISOString()}, which is already past. scheduleForSubtask does not queue a PENDING reminder in that case, and no reminder email will be sent for this deadline.`,
      );
      lines.push(
        `  A subtask saved from now on records that as SUPPRESSED, with: ${skippedReminderReason({
          reminderLeadMinutes: input.subtask.reminderLeadMinutes,
          remindAt,
          savedAt: input.now,
        })}`,
      );
    } else {
      lines.push(
        `  no row exists yet, and the reminder moment ${formatIST(remindAt)} is still in the future. The next save should queue a PENDING reminder.`,
      );
    }
  } else {
    for (const row of reminderRows) {
      lines.push(`  ${row.status} for ${row.recipientEmail}: ${dispatchFate(row, input)}`);
    }
  }

  const others = input.notifications.filter((row) => row.type !== 'DEADLINE_REMINDER');
  lines.push('', 'Other rows on this subtask');
  if (others.length === 0) lines.push('  none');
  for (const row of others) {
    lines.push(
      `  ${row.type} ${row.status} for ${row.recipientEmail}: ${dispatchFate(row, input)}`,
    );
  }

  lines.push(
    '',
    'Nothing was sent or written. Start the worker with `pnpm worker` when you want the sweep to actually run.',
  );

  return lines.join('\n');
}
