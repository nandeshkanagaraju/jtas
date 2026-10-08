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

import type { JobTimeline, TimelineStep } from './timeline';

/** Telegram refuses a message past 4096 characters. Leave room for the ellipsis. */
const LIMIT = 4000;

function clip(text: string): string {
  const flat = text.trim();
  if (flat.length <= LIMIT) return flat;
  return `${flat.slice(0, LIMIT - 1)}…`;
}

function lines(...rows: Array<string | null | undefined>): string {
  return rows.filter((row): row is string => Boolean(row && row.trim())).join('\n');
}

function blocks(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join('\n\n');
}

/**
 * The step this reader owns. A notice about the previous department still
 * points at that reader's own task, so "your task" is not always the subject
 * of the mail.
 */
function readerStep(
  timeline: JobTimeline,
  readerUserId: string,
  aboutSubtaskId: string | null,
): TimelineStep | null {
  const own = timeline.steps.filter((step) => step.assigneeId === readerUserId);
  if (own.length === 0) return null;
  return (
    own.find((step) => aboutSubtaskId !== null && step.dependsOnId === aboutSubtaskId) ??
    own.find((step) => step.id === aboutSubtaskId) ??
    own[0] ??
    null
  );
}

function jobHeader(
  payload: {
    jobCode: string;
    jobTitle: string;
    partNumber: string | null;
    drawingNumber: string | null;
  },
  timeline: JobTimeline | null,
): string {
  return lines(
    payload.jobCode,
    payload.jobTitle,
    '',
    payload.partNumber ? `Part: ${payload.partNumber}` : null,
    payload.drawingNumber ? `Drawing: ${payload.drawingNumber}` : null,
    timeline?.quantity != null ? `Quantity: ${timeline.quantity}` : null,
    timeline ? `Opened by: ${timeline.createdByName}` : null,
    timeline?.description ? `About this job: ${timeline.description}` : null,
  );
}

function yourWork(step: TimelineStep | null): string | null {
  if (!step) return null;
  return lines(
    'Your work',
    `${step.departmentName} — ${step.title}`,
    step.description,
    `Assigned to: ${step.assigneeName}`,
    `Status: ${step.statusLine}`,
    step.finishDate ? `Finish date: ${step.finishDate}` : 'Finish date: not set yet',
  );
}

function timelineBlock(timeline: JobTimeline, readerUserId: string | null): string {
  const steps = timeline.steps.map((step, index) => {
    const yours = readerUserId !== null && step.assigneeId === readerUserId;
    return lines(
      `${index + 1}. ${step.departmentName} — ${step.title}${yours ? '  ← you' : ''}`,
      step.description,
      `Assigned to: ${step.assigneeName}`,
      step.statusLine,
      step.finishDate ? `Finish date: ${step.finishDate}` : 'Finish date: not set yet',
      step.recorded ? `Recorded: ${step.recorded}` : null,
      ...step.problems,
    );
  });

  const first = timeline.steps[0];
  const lead =
    first && readerUserId !== null && first.assigneeId === readerUserId
      ? 'You are first on this job. No earlier department has a date yet.'
      : null;

  return blocks('Job timeline', lead, ...steps);
}

function subjectTask(payload: TemplatePayload): string | null {
  if (!('departmentName' in payload)) return null;
  return lines(
    'This task',
    `${payload.departmentName} — ${payload.subtaskTitle}`,
    `Assigned to: ${payload.assigneeName}`,
    'deadlineIst' in payload ? `Finish date: ${payload.deadlineIst}` : null,
  );
}

function frame(
  payload: TemplatePayload & {
    jobCode: string;
    jobTitle: string;
    partNumber: string | null;
    drawingNumber: string | null;
  },
  timeline: JobTimeline | null,
  readerUserId: string | null,
  action: string,
): string {
  const aboutId = 'subtaskId' in payload ? payload.subtaskId : null;
  const step = timeline && readerUserId ? readerStep(timeline, readerUserId, aboutId) : null;
  const work = step
    ? blocks(yourWork(step), action)
    : blocks(subjectTask(payload), lines('What to do', action));
  return clip(blocks(jobHeader(payload, timeline), work));
}

/**
 * The job timeline on its own. Sent before the task message, which carries
 * the buttons.
 */
export function timelineNotice(
  header: {
    jobCode: string;
    jobTitle: string;
    partNumber: string | null;
    drawingNumber: string | null;
  },
  timeline: JobTimeline,
  readerUserId: string | null,
): string {
  return clip(blocks(jobHeader(header, timeline), timelineBlock(timeline, readerUserId)));
}

/** `/job` answers with the timeline only. The task message is the one with buttons. */
export function jobTimelineMessage(
  header: {
    jobCode: string;
    jobTitle: string;
    partNumber: string | null;
    drawingNumber: string | null;
  },
  timeline: JobTimeline,
  readerUserId: string | null,
): string {
  return timelineNotice(header, timeline, readerUserId);
}

/**
 * The chat message. `timeline` is the whole job at send time. `readerUserId`
 * marks that person's step. Without either, the message still names the job
 * and the task the notice is about.
 */
export function plainTextFor(
  payload: TemplatePayload,
  timeline: JobTimeline | null = null,
  readerUserId: string | null = null,
): string {
  switch (payload.kind) {
    case 'SUBTASK_ASSIGNED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.subtaskTitle} has been assigned to you.`,
          `Finish date: ${payload.deadlineIst}`,
          `A reminder arrives ${formatDuration(payload.reminderLeadMinutes)} before it is due.`,
        ),
      );
    case 'DEADLINE_REMINDER':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `Due in ${formatElapsed(payload.minutesLeft)}.`,
          `Finish date: ${payload.deadlineIst}.`,
        ),
      );
    case 'OVERDUE_MEMBER':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.subtaskTitle} is overdue by ${formatElapsed(payload.delayMinutes)}.`,
          `It was due ${payload.deadlineIst} and is still ${payload.status}.`,
        ),
      );
    case 'OVERDUE_MD':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.departmentName} (${payload.assigneeName}) is overdue by ${formatElapsed(payload.delayMinutes)}.`,
          `Finish date: ${payload.deadlineIst}`,
          `Status: ${payload.status}`,
          'No completion or problem report has been received.',
        ),
      );
    case 'PROBLEM_RAISED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.severity} problem, raised by ${payload.raisedByName}.`,
          `Finish date: ${payload.deadlineIst}`,
          payload.description,
        ),
      );
    case 'PROBLEM_RESOLVED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(`The problem is ${payload.action.toLowerCase()}.`, payload.mdActionNote),
      );
    case 'COMMITMENT_OPEN':
    case 'COMMITMENT_REMINDER':
    case 'COMMITMENT_MISSED_MEMBER': {
      const aboutId = payload.subtaskId;
      const step = timeline && readerUserId ? readerStep(timeline, readerUserId, aboutId) : null;
      const previous = step?.dependsOnId
        ? timeline?.steps.find((row) => row.id === step.dependsOnId)
        : null;
      const ahead = previous
        ? lines(
            `${previous.departmentName} has finished ${previous.title}.`,
            previous.finishDate
              ? `Their finish date was ${previous.finishDate}. That is the date you were planning against.`
              : 'They finished without a finish date.',
            previous.recorded ? `They recorded: ${previous.recorded}` : null,
            ...previous.problems,
          )
        : 'You are first on this job. No earlier department has a date to plan against.';
      const ask =
        payload.kind === 'COMMITMENT_OPEN'
          ? lines(
              `Commit a finish date by ${payload.commitmentDueIst}.`,
              'Choose a date below. You confirm it before it is saved, and you cannot change it afterwards.',
            )
          : payload.kind === 'COMMITMENT_REMINDER'
            ? lines(
                `${formatDuration(payload.minutesLeft)} left to commit a finish date.`,
                `Commit by ${payload.commitmentDueIst}, or report a problem and say why you cannot.`,
              )
            : lines(
                `The time to commit a date has passed. It was due ${payload.commitmentDueIst}.`,
                'Commit the date now, or report a problem and write the reason. The MD has been told.',
              );
      return frame(payload, timeline, readerUserId, [ahead, ask].join('\n\n'));
    }
    case 'COMMITMENT_MISSED_MD':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.assigneeName} has not committed a finish date.`,
          `The 24 hours ended at ${payload.commitmentDueIst}.`,
        ),
      );
    case 'COMMITMENT_MADE':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.departmentName} committed a finish date: ${payload.deadlineIst}.`,
          `Their task: ${payload.subtaskTitle}.`,
          'You do not set your own date yet. You set it when they finish.',
          'Use their date to get ready.',
        ),
      );
    case 'DEADLINE_CHANGED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `Was: ${payload.oldDeadlineIst}`,
          `Now: ${payload.deadlineIst}`,
          payload.reason ? `Reason: ${payload.reason}` : null,
        ),
      );
    case 'PREDECESSOR_DATE_CHANGED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.departmentName} moved their finish date.`,
          `Was: ${payload.oldDeadlineIst}`,
          `Now: ${payload.deadlineIst}`,
          payload.reason ? `Reason: ${payload.reason}` : null,
          'You still set your own date only after they finish. Plan against the new date.',
        ),
      );
    case 'READY_TO_START':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.predecessorDepartment} finished ${payload.predecessorTitle}.`,
          payload.predecessorDeadlineIst
            ? `Their finish date was ${payload.predecessorDeadlineIst}.`
            : null,
          'They have finished, so you can start.',
          payload.deadlineIst === 'Not committed'
            ? 'Your finish date is not set yet.'
            : `Your finish date: ${payload.deadlineIst}`,
        ),
      );
    case 'EXTENSION_REQUESTED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.requestedByName} has asked to move the deadline to ${payload.requestedDeadlineIst}.`,
          `Finish date now: ${payload.deadlineIst}`,
          payload.reason,
        ),
      );
    case 'APPROVAL_REQUIRED':
      return frame(
        payload,
        timeline,
        readerUserId,
        lines(
          `${payload.completedByName} marked this completed. It counts as done once you approve it.`,
          payload.completionNote,
        ),
      );
    case 'JOB_COMPLETED':
      return clip(
        blocks(
          jobHeader(payload, timeline),
          lines(
            'What to do',
            `The job is complete. Finished ${payload.completedIst}.`,
            `${payload.subtaskCount} tasks.`,
            payload.onTime ? 'Finished on time.' : 'Finished after the job deadline.',
          ),
        ),
      );
    case 'DAILY_DIGEST_MD':
      return clip(
        lines(
          `Daily summary ${payload.dateIst}`,
          '',
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

/** Pending and in-progress work the assignee can still move. */
function workButtons(id: string, status: string): OutboundAction[][] {
  if (status !== 'pending' && status !== 'in progress') return [];
  const rows: OutboundAction[][] = [];
  if (status === 'pending') {
    rows.push([{ label: 'Start work', data: `start:${id}` }]);
  }
  rows.push([
    { label: 'Mark completed', data: `done:${id}` },
    { label: 'Report problem', data: `prob:${id}` },
  ]);
  rows.push([
    { label: '+2 days', data: `d2:${id}` },
    { label: '+5 days', data: `d5:${id}` },
    { label: '+1 week', data: `d7:${id}` },
  ]);
  rows.push([{ label: 'Set deadline', data: `d0:${id}` }]);
  rows.push(attach(id));
  return rows;
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
 * Buttons for the messages a person can act on.
 *
 * Assignment, the reminder, overdue, and ready-to-start offer the same work
 * the website does, when the step is still pending or in progress. A
 * commitment message offers the common dates, then asks for a confirmation
 * before anything is written. An approval notice is for the MD.
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

  if (payload.kind === 'APPROVAL_REQUIRED') {
    return [
      [
        { label: 'Approve', data: `ok:${id}` },
        { label: 'Send back', data: `back:${id}` },
      ],
    ];
  }

  if (
    payload.kind === 'SUBTASK_ASSIGNED' ||
    payload.kind === 'DEADLINE_REMINDER' ||
    payload.kind === 'OVERDUE_MEMBER' ||
    payload.kind === 'READY_TO_START'
  ) {
    return workButtons(id, payload.status);
  }

  return [];
}
