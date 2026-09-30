/**
 * The member-facing mails — SDD section 5.4.
 *
 * `OVERDUE_MEMBER` and `DEADLINE_REMINDER` use the SDD's wording verbatim. The
 * register is deliberately plain and direct: these are read on a phone between
 * machines, and a paragraph of throat-clearing is a mail that gets skimmed.
 */
import { Section, Text } from '@react-email/components';

import { formatDuration } from '@/lib/utils/duration';

import { ActionButton, COLORS, EmailLayout, FactTable, Heading, Paragraph } from './layout';
import { subtaskLink } from './links';
import type {
  ApprovalRequiredPayload,
  AssignedPayload,
  DeadlineChangedPayload,
  OverdueMemberPayload,
  ReminderPayload,
} from './types';

/** The identity block every subtask mail leads with. */
function subtaskFacts(payload: {
  jobCode: string;
  jobTitle: string;
  partNumber: string | null;
  drawingNumber: string | null;
  departmentName: string;
  deadlineIst: string;
}): Array<[string, string | null]> {
  return [
    ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
    [
      'Part / Drawing',
      [payload.partNumber, payload.drawingNumber].filter(Boolean).join(' / ') || null,
    ],
    ['Department', payload.departmentName],
    ['Deadline', payload.deadlineIst],
  ];
}

export function SubtaskAssignedEmail(payload: AssignedPayload) {
  return (
    <EmailLayout preview={`${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>You have a new task</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        <strong>{payload.subtaskTitle}</strong> has been assigned to you.
      </Paragraph>

      <FactTable rows={subtaskFacts(payload)} />

      <Paragraph muted>
        You will get a reminder {formatDuration(payload.reminderLeadMinutes)} before it is due. If
        anything stops you, open the task and choose <strong>Report problem</strong> so the Managing
        Director can act on it.
      </Paragraph>

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function DeadlineReminderEmail(payload: ReminderPayload) {
  return (
    <EmailLayout
      preview={`Due in ${formatDuration(payload.minutesLeft)} — ${payload.subtaskTitle}`}
    >
      <Heading>Due in {formatDuration(payload.minutesLeft)}</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        Your task <strong>{payload.subtaskTitle}</strong> is due on{' '}
        <strong>{payload.deadlineIst}</strong>.
      </Paragraph>

      <FactTable rows={subtaskFacts(payload)} />

      <Paragraph muted>
        If you are held up by something, open the task and choose <strong>Report problem</strong>{' '}
        with the reason, so that the MD can act on it.
      </Paragraph>

      <Section>
        <ActionButton href={subtaskLink(payload.subtaskId, 'complete')} label="Mark completed" />
        <Text style={{ display: 'inline-block', width: 12 }} />
        <ActionButton href={subtaskLink(payload.subtaskId, 'problem')} label="Report problem" />
      </Section>
    </EmailLayout>
  );
}

/** SDD section 5.4, `OVERDUE_MEMBER` — wording taken from the document. */
export function OverdueMemberEmail(payload: OverdueMemberPayload) {
  return (
    <EmailLayout preview={`Please complete: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>Please complete the work</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        Your task <strong>{payload.subtaskTitle}</strong> for job <strong>{payload.jobCode}</strong>{' '}
        was due on <strong>{payload.deadlineIst}</strong> and is still marked{' '}
        <em>{payload.status}</em>. Please complete the work and update the status.
      </Paragraph>
      <Paragraph>
        If you are held up by something, open the task and choose <strong>Report problem</strong>{' '}
        with the reason, so that the MD can act on it.
      </Paragraph>

      <FactTable
        rows={[...subtaskFacts(payload), ['Delay', formatDuration(payload.delayMinutes)]]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId, 'complete')} label="Update task now" />

      <Paragraph muted>The Managing Director has been copied on this reminder.</Paragraph>
    </EmailLayout>
  );
}

export function DeadlineChangedEmail(payload: DeadlineChangedPayload) {
  return (
    <EmailLayout preview={`New deadline for ${payload.subtaskTitle}`}>
      <Heading>Your deadline has changed</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        The deadline for <strong>{payload.subtaskTitle}</strong> has moved.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          ['Was', payload.oldDeadlineIst],
          ['Now', payload.deadlineIst],
          ['Reason', payload.reason],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function ApprovalRequiredEmail(payload: ApprovalRequiredPayload) {
  return (
    <EmailLayout preview={`Approval needed: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>A task is waiting for your approval</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        {payload.completedByName} has marked <strong>{payload.subtaskTitle}</strong> as completed.
        It counts as done once you approve it.
      </Paragraph>

      <FactTable
        rows={[
          ...subtaskFacts(payload),
          ['Completed by', payload.completedByName],
          ['Note', payload.completionNote],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Review and approve" />
    </EmailLayout>
  );
}

/** Colour used when a mail is about something already late. */
export const OVERDUE_COLOR = COLORS.overdue;
