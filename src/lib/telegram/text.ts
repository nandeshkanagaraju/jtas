/**
 * Short plain text for a chat, and the buttons that go with it.
 *
 * The same text is what a later WhatsApp message would carry. Buttons are
 * labels plus an opaque action id; only the Telegram adapter knows that
 * Telegram calls them an inline keyboard.
 */
import type { OutboundAction } from '@/lib/notifications/channels/types';
import type { TemplatePayload } from '@/lib/notifications/templates/types';
import { formatDuration } from '@/lib/utils/duration';

const LIMIT = 300;

function lead(jobCode: string, partNumber: string | null): string {
  return partNumber ? `${jobCode} · ${partNumber}` : jobCode;
}

function clip(text: string): string {
  const flat = text.trim();
  if (flat.length <= LIMIT) return flat;
  return `${flat.slice(0, LIMIT - 1)}…`;
}

/** One screen, job code and part number first. Never longer than 300 characters. */
export function plainTextFor(payload: TemplatePayload): string {
  switch (payload.kind) {
    case 'READY_TO_START':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\nYou can start: ${payload.departmentName}. ${payload.predecessorDepartment} is done.`,
      );
    case 'DEADLINE_REMINDER':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\n${payload.departmentName} is due ${payload.deadlineIst}. ${formatDuration(payload.minutesLeft)} left.`,
      );
    case 'OVERDUE_MEMBER':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\n${payload.departmentName} is overdue by ${formatDuration(payload.delayMinutes)}.`,
      );
    case 'OVERDUE_MD':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\n${payload.departmentName} (${payload.assigneeName}) is overdue by ${formatDuration(payload.delayMinutes)}.`,
      );
    case 'PROBLEM_RAISED':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\nProblem on ${payload.departmentName}, raised by ${payload.raisedByName}: ${payload.description}`,
      );
    case 'PROBLEM_RESOLVED':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\nProblem on ${payload.departmentName} is ${payload.action.toLowerCase()}. ${payload.mdActionNote}`,
      );
    case 'COMMITMENT_OPEN':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\nCommit a finish date for ${payload.departmentName} by ${payload.commitmentDueIst}.`,
      );
    case 'COMMITMENT_REMINDER':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\nCommit a finish date for ${payload.departmentName}. ${formatDuration(payload.minutesLeft)} left in the window.`,
      );
    case 'DEADLINE_CHANGED':
      return clip(
        `${lead(payload.jobCode, payload.partNumber)}\n${payload.departmentName} finish date is now ${payload.deadlineIst}.`,
      );
    default:
      return clip(
        `${'jobCode' in payload ? payload.jobCode : 'JTAS'}\n${payload.kind.replace(/_/g, ' ').toLowerCase()}`,
      );
  }
}

/**
 * Buttons for the messages a member can act on.
 *
 * Overdue and the work reminder can be finished or blocked. A commitment
 * message offers the common dates. Everything else is text only.
 */
export function actionsFor(payload: TemplatePayload): OutboundAction[][] {
  if (
    payload.kind !== 'OVERDUE_MEMBER' &&
    payload.kind !== 'DEADLINE_REMINDER' &&
    payload.kind !== 'COMMITMENT_OPEN' &&
    payload.kind !== 'COMMITMENT_REMINDER'
  ) {
    return [];
  }

  const id = payload.subtaskId;

  if (payload.kind === 'COMMITMENT_OPEN' || payload.kind === 'COMMITMENT_REMINDER') {
    return [
      [
        { label: '+2 days', data: `d2:${id}` },
        { label: '+5 days', data: `d5:${id}` },
        { label: '+1 week', data: `d7:${id}` },
      ],
      [{ label: 'Other date', data: `d0:${id}` }],
    ];
  }

  return [
    [
      { label: 'Mark completed', data: `done:${id}` },
      { label: 'Report problem', data: `prob:${id}` },
    ],
  ];
}
