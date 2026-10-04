/**
 * The member-facing mails — SDD section 5.4.
 *
 * `OVERDUE_MEMBER` and `DEADLINE_REMINDER` use the SDD's wording verbatim. The
 * register is deliberately plain and direct: these are read on a phone between
 * machines, and a paragraph of throat-clearing is a mail that gets skimmed.
 */
import { Section, Text } from '@react-email/components';

import { formatDuration, formatElapsed } from '@/lib/utils/duration';

import { ActionButton, COLORS, EmailLayout, FactTable, Heading, Paragraph } from './layout';
import { subtaskLink } from './links';
import type {
  ApprovalRequiredPayload,
  AssignedPayload,
  CommitmentMadePayload,
  CommitmentMissedMdPayload,
  CommitmentMissedMemberPayload,
  CommitmentOpenPayload,
  CommitmentReminderPayload,
  DeadlineChangedPayload,
  OverdueMemberPayload,
  ReadyToStartPayload,
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
    <EmailLayout preview={`Due in ${formatElapsed(payload.minutesLeft)} — ${payload.subtaskTitle}`}>
      <Heading>Due in {formatElapsed(payload.minutesLeft)}</Heading>
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
        rows={[...subtaskFacts(payload), ['Delay', formatElapsed(payload.delayMinutes)]]}
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

export function CommitmentOpenEmail(payload: CommitmentOpenPayload) {
  return (
    <EmailLayout preview={`You can commit: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>You can commit</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        <strong>{payload.subtaskTitle}</strong> is yours. Commit a finish date by{' '}
        <strong>{payload.commitmentDueIst}</strong>. That is 24 hours from the moment this task
        became yours, and the clock does not pause overnight.
      </Paragraph>
      <Paragraph>You can start the work now. The date is what is being asked for.</Paragraph>

      <FactTable
        rows={[
          ...subtaskFacts({ ...payload, deadlineIst: payload.commitmentDueIst }),
          ['Commit by', payload.commitmentDueIst],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Commit a date" />
    </EmailLayout>
  );
}

export function CommitmentReminderEmail(payload: CommitmentReminderPayload) {
  return (
    <EmailLayout preview={`Commit a date: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>Six hours left to commit</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        <strong>{payload.subtaskTitle}</strong> still has no finish date. Commit one by{' '}
        <strong>{payload.commitmentDueIst}</strong>, or report a problem and say why you cannot.
      </Paragraph>

      <FactTable rows={[['Commit by', payload.commitmentDueIst]]} />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Commit a date" />
    </EmailLayout>
  );
}

export function CommitmentMissedMemberEmail(payload: CommitmentMissedMemberPayload) {
  return (
    <EmailLayout preview={`Commitment missed: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>The time to commit a date has passed</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        <strong>{payload.subtaskTitle}</strong> was due a finish date at{' '}
        <strong>{payload.commitmentDueIst}</strong>. Commit the date now, or report a problem and
        write the reason. The MD has been told.
      </Paragraph>

      <FactTable rows={[['Commit was due', payload.commitmentDueIst]]} />

      <ActionButton href={subtaskLink(payload.subtaskId, 'problem')} label="Commit or report why" />
    </EmailLayout>
  );
}

export function CommitmentMissedMdEmail(payload: CommitmentMissedMdPayload) {
  return (
    <EmailLayout preview={`Commitment missed: ${payload.jobCode} — ${payload.departmentName}`}>
      <Heading>A department missed its commitment window</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        {payload.assigneeName} ({payload.departmentName}) has not committed a finish date for{' '}
        <strong>{payload.subtaskTitle}</strong>. The 24 hours ended at {payload.commitmentDueIst}.
        They have been asked to commit, or to report why they cannot.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          ['Department', payload.departmentName],
          ['Assignee', payload.assigneeName],
          ['Commit was due', payload.commitmentDueIst],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function CommitmentMadeEmail(payload: CommitmentMadePayload) {
  return (
    <EmailLayout preview={`Date committed: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>The previous step has a date</Heading>
      <Paragraph>Dear {payload.readerName},</Paragraph>
      <Paragraph>
        {payload.departmentName} committed a finish date of <strong>{payload.deadlineIst}</strong>{' '}
        for <strong>{payload.subtaskTitle}</strong>. You are next. Your own date is not due until
        that step is finished.
      </Paragraph>

      <FactTable rows={subtaskFacts(payload)} />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function ReadyToStartEmail(payload: ReadyToStartPayload) {
  return (
    <EmailLayout preview={`You can start: ${payload.jobCode} — ${payload.subtaskTitle}`}>
      <Heading>You can start</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        <strong>{payload.predecessorTitle}</strong> ({payload.predecessorDepartment}) is complete.
        You can start <strong>{payload.subtaskTitle}</strong>.
      </Paragraph>

      <FactTable rows={subtaskFacts(payload)} />

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
