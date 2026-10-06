/**
 * Plain text for a chat, and the buttons that go with it.
 *
 * The same facts the email carries, laid out so a phone can scan them. The
 * job comes first. Buttons are labels plus an opaque action id; only the
 * Telegram adapter knows that Telegram calls them an inline keyboard.
 */
import type { OutboundAction } from '@/lib/notifications/channels/types';
import type { TemplatePayload } from '@/lib/notifications/templates/types';
import { formatDuration, formatElapsed } from '@/lib/utils/duration';

/** Telegram refuses a message past 4096 characters. Leave room for the ellipsis. */
const LIMIT = 4000;

function clip(text: string): string {
  const flat = text.trim();
  if (flat.length <= LIMIT) return flat;
  return `${flat.slice(0, LIMIT - 1)}…`;
}

function partLine(partNumber: string | null, drawingNumber: string | null): string | null {
  const value = [partNumber, drawingNumber].filter(Boolean).join(' / ');
  return value ? `Part / drawing ${value}` : null;
}

function lines(...rows: Array<string | null | undefined>): string {
  return rows.filter((row): row is string => Boolean(row && row.trim())).join('\n');
}

function identity(payload: {
  jobCode: string;
  jobTitle: string;
  partNumber: string | null;
  drawingNumber: string | null;
  departmentName: string;
  subtaskTitle: string;
  assigneeName: string;
}): string {
  return lines(
    `${payload.jobCode} — ${payload.jobTitle}`,
    partLine(payload.partNumber, payload.drawingNumber),
    `${payload.departmentName} · ${payload.subtaskTitle}`,
    `Assigned to ${payload.assigneeName}`,
  );
}

/** The facts the matching email puts in its table, plus the sentence that says why it arrived. */
export function plainTextFor(payload: TemplatePayload): string {
  switch (payload.kind) {
    case 'SUBTASK_ASSIGNED':
      return clip(
        lines(
          identity(payload),
          `${payload.subtaskTitle} has been assigned to you.`,
          `Deadline ${payload.deadlineIst}`,
          `A reminder arrives ${formatDuration(payload.reminderLeadMinutes)} before it is due.`,
        ),
      );
    case 'DEADLINE_REMINDER':
      return clip(
        lines(
          identity(payload),
          `Due in ${formatElapsed(payload.minutesLeft)}.`,
          `${payload.subtaskTitle} is due ${payload.deadlineIst}.`,
        ),
      );
    case 'OVERDUE_MEMBER':
      return clip(
        lines(
          identity(payload),
          `${payload.subtaskTitle} is overdue by ${formatElapsed(payload.delayMinutes)}.`,
          `It was due ${payload.deadlineIst} and is still ${payload.status}.`,
        ),
      );
    case 'OVERDUE_MD':
      return clip(
        lines(
          identity(payload),
          `${payload.departmentName} (${payload.assigneeName}) is overdue by ${formatElapsed(payload.delayMinutes)}.`,
          `Deadline ${payload.deadlineIst}`,
          `Status ${payload.status}`,
          'No completion or problem report has been received.',
        ),
      );
    case 'PROBLEM_RAISED':
      return clip(
        lines(
          identity(payload),
          `${payload.severity} problem, raised by ${payload.raisedByName}.`,
          `Deadline ${payload.deadlineIst}`,
          payload.description,
        ),
      );
    case 'PROBLEM_RESOLVED':
      return clip(
        lines(
          identity(payload),
          `The problem is ${payload.action.toLowerCase()}.`,
          payload.mdActionNote,
        ),
      );
    case 'COMMITMENT_OPEN':
      return clip(
        lines(
          identity(payload),
          `Commit a finish date by ${payload.commitmentDueIst}.`,
          'You can start the work now. Choose a date below. You will be asked to confirm it, and you cannot change it afterwards.',
        ),
      );
    case 'COMMITMENT_REMINDER':
      return clip(
        lines(
          identity(payload),
          `${formatDuration(payload.minutesLeft)} left to commit a finish date.`,
          `Commit by ${payload.commitmentDueIst}, or report a problem and say why you cannot.`,
        ),
      );
    case 'COMMITMENT_MISSED_MEMBER':
      return clip(
        lines(
          identity(payload),
          `The time to commit a date has passed. It was due ${payload.commitmentDueIst}.`,
          'Commit the date now, or report a problem and write the reason. The MD has been told.',
        ),
      );
    case 'COMMITMENT_MISSED_MD':
      return clip(
        lines(
          identity(payload),
          `${payload.assigneeName} has not committed a finish date.`,
          `The 24 hours ended at ${payload.commitmentDueIst}.`,
        ),
      );
    case 'COMMITMENT_MADE':
      return clip(
        lines(
          identity(payload),
          `${payload.departmentName} committed ${payload.deadlineIst}.`,
          'You are next. Your own date is not due until that step is finished.',
        ),
      );
    case 'DEADLINE_CHANGED':
      return clip(
        lines(
          identity(payload),
          `Was ${payload.oldDeadlineIst}`,
          `Now ${payload.deadlineIst}`,
          payload.reason ? `Reason ${payload.reason}` : null,
        ),
      );
    case 'PREDECESSOR_DATE_CHANGED':
      return clip(
        lines(
          identity(payload),
          `${payload.departmentName}'s finish date moved.`,
          `Was ${payload.oldDeadlineIst}`,
          `Now ${payload.deadlineIst}`,
          payload.reason ? `Reason ${payload.reason}` : null,
          'You are next. This is the date you plan against. Your own date is not due until that step is finished.',
        ),
      );
    case 'READY_TO_START':
      return clip(
        lines(
          identity(payload),
          payload.predecessorDeadlineIst
            ? `${payload.predecessorTitle} (${payload.predecessorDepartment}) is done. They had committed ${payload.predecessorDeadlineIst}. You can start.`
            : `${payload.predecessorTitle} (${payload.predecessorDepartment}) is done. You can start.`,
          payload.deadlineIst === 'Not committed' ? null : `Deadline ${payload.deadlineIst}`,
        ),
      );
    case 'EXTENSION_REQUESTED':
      return clip(
        lines(
          identity(payload),
          `${payload.requestedByName} has asked to move the deadline to ${payload.requestedDeadlineIst}.`,
          `Deadline ${payload.deadlineIst}`,
          payload.reason,
        ),
      );
    case 'APPROVAL_REQUIRED':
      return clip(
        lines(
          identity(payload),
          `${payload.completedByName} marked this completed. It counts as done once you approve it.`,
          payload.completionNote,
        ),
      );
    case 'JOB_COMPLETED':
      return clip(
        lines(
          `${payload.jobCode} — ${payload.jobTitle} is complete.`,
          partLine(payload.partNumber, payload.drawingNumber),
          `Finished ${payload.completedIst}`,
          `${payload.subtaskCount} tasks`,
          payload.onTime ? 'Finished on time.' : 'Finished after the job deadline.',
        ),
      );
    case 'DAILY_DIGEST_MD':
      return clip(
        lines(
          `Daily summary ${payload.dateIst}`,
          `${payload.overdue.length} overdue, ${payload.dueToday.length} due today, ${payload.openProblems.length} open problems.`,
          ...payload.overdue.map(
            (row) =>
              `Overdue: ${row.jobCode} · ${row.departmentName} · ${row.subtaskTitle} (${row.assigneeName}), due ${row.deadlineIst}`,
          ),
          ...payload.dueToday.map(
            (row) =>
              `Due today: ${row.jobCode} · ${row.departmentName} · ${row.subtaskTitle} (${row.assigneeName}), due ${row.deadlineIst}`,
          ),
          ...payload.openProblems.map(
            (row) =>
              `${row.severity} problem: ${row.jobCode} · ${row.departmentName} · ${row.subtaskTitle} — ${row.description}`,
          ),
        ),
      );
  }
}

function attach(id: string): OutboundAction[] {
  return [{ label: 'Attach a file', data: `file:${id}` }];
}

function commitmentButtons(id: string): OutboundAction[][] {
  return [
    [
      { label: '+2 days', data: `d2:${id}` },
      { label: '+5 days', data: `d5:${id}` },
      { label: '+1 week', data: `d7:${id}` },
    ],
    [{ label: 'Other date', data: `d0:${id}` }],
    attach(id),
  ];
}

/**
 * Buttons for the messages a member can act on.
 *
 * Overdue and the work reminder can be finished, blocked, or have a file
 * added. A commitment message — including one sent after the window — offers
 * the common dates, then asks for a confirmation before anything is written.
 */
export function actionsFor(payload: TemplatePayload): OutboundAction[][] {
  if (!('subtaskId' in payload)) return [];
  const id = payload.subtaskId;

  if (
    payload.kind === 'COMMITMENT_OPEN' ||
    payload.kind === 'COMMITMENT_REMINDER' ||
    payload.kind === 'COMMITMENT_MISSED_MEMBER'
  ) {
    return commitmentButtons(id);
  }

  if (payload.kind === 'OVERDUE_MEMBER' || payload.kind === 'DEADLINE_REMINDER') {
    return [
      [
        { label: 'Mark completed', data: `done:${id}` },
        { label: 'Report problem', data: `prob:${id}` },
      ],
      attach(id),
    ];
  }

  if (payload.kind === 'READY_TO_START') return [attach(id)];

  return [];
}
