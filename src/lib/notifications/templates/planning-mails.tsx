/**
 * Planning-ahead mails: an earlier step on the route has a date (option A),
 * and the morning "coming your way" list for a department (option B).
 *
 * Both are informational. Neither asks the reader to do anything yet; the
 * "you can start" mail is still READY_TO_START, sent only when it is their turn.
 */
import { ActionButton, EmailLayout, FactTable, Heading, Paragraph } from './layout';
import { myTasksLink, subtaskLink } from './links';
import type { DepartmentLookaheadPayload, UpstreamDateUpdatePayload } from './types';

function routeLine(payload: UpstreamDateUpdatePayload): string {
  return [payload.departmentName, ...payload.stepsBetween, payload.readerDepartment].join(' → ');
}

export function UpstreamDateUpdateEmail(payload: UpstreamDateUpdatePayload) {
  const moved = payload.previousDeadlineIst !== null;
  return (
    <EmailLayout
      preview={`${payload.jobCode}: ${payload.departmentName} ${moved ? 'now' : 'expects to'} finish ${payload.deadlineIst}`}
    >
      <Heading>Plan ahead: an earlier step has a date</Heading>
      <Paragraph>Dear {payload.readerName},</Paragraph>
      <Paragraph>
        {moved ? (
          <>
            The date for <strong>{payload.subtaskTitle}</strong> ({payload.departmentName}) has
            moved from {payload.previousDeadlineIst} to <strong>{payload.deadlineIst}</strong>.
          </>
        ) : (
          <>
            {payload.departmentName} expects to finish <strong>{payload.subtaskTitle}</strong> by{' '}
            <strong>{payload.deadlineIst}</strong>.
          </>
        )}{' '}
        Your step, <strong>{payload.readerStepTitle}</strong>, comes after{' '}
        {payload.stepsBetween.length === 1
          ? 'one more step'
          : `${payload.stepsBetween.length} more steps`}
        . Nothing to do yet: we will tell you when it is your turn.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          [
            'Part / Drawing',
            [payload.partNumber, payload.drawingNumber].filter(Boolean).join(' / ') || null,
          ],
          ['Route', routeLine(payload)],
          [moved ? 'New date' : 'Expected finish', payload.deadlineIst],
          ['Was', payload.previousDeadlineIst],
          ['Your step', payload.readerStepTitle],
        ]}
      />

      <ActionButton href={subtaskLink(payload.readerSubtaskId)} label="Open your task" />
    </EmailLayout>
  );
}

export function DepartmentLookaheadEmail(payload: DepartmentLookaheadPayload) {
  const count = payload.rows.length;
  return (
    <EmailLayout
      preview={`${count} job${count === 1 ? '' : 's'} heading to ${payload.readerDepartmentName}`}
    >
      <Heading>Coming your way — {payload.dateIst}</Heading>
      <Paragraph>Dear {payload.readerName},</Paragraph>
      <Paragraph>
        {count === 1 ? 'One job is' : `${count} jobs are`} on the way to{' '}
        {payload.readerDepartmentName}. Nothing to do yet; this is so you can plan material,
        machines and people before the work reaches you.
      </Paragraph>

      {/* One block per job rather than a wide table: it reads on a phone, and
          the plain-text part keeps one fact per line. */}
      {payload.rows.map((row) => (
        <FactTable
          key={row.readerSubtaskId}
          rows={[
            ['Job', `${row.jobCode} — ${row.jobTitle}`],
            ['Your step', row.readerStepTitle],
            [
              'Now at',
              `${row.nowAt} (${row.stepsAway === 1 ? 'the step before yours' : `${row.stepsAway} steps before yours`})`,
            ],
            ['Expected with you', row.expectedIst],
          ]}
        />
      ))}

      <ActionButton href={myTasksLink()} label="Open My work" />
    </EmailLayout>
  );
}
