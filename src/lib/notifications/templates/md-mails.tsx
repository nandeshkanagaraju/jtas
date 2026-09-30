/**
 * The MD-facing mails — SDD section 5.4.
 *
 * Formal register and "Dear Sir", as the SDD specifies. `OVERDUE_MD` uses the
 * document's wording and its exact table layout.
 */
import { Section, Text } from '@react-email/components';

import { formatDuration } from '@/lib/utils/duration';

import { ActionButton, COLORS, EmailLayout, FactTable, Heading, Paragraph } from './layout';
import { jobLink, problemInboxLink, subtaskLink } from './links';
import type {
  DailyDigestPayload,
  DigestRow,
  ExtensionRequestedPayload,
  JobCompletedPayload,
  OverdueMdPayload,
  ProblemRaisedPayload,
  ProblemResolvedPayload,
} from './types';

/** SDD section 5.4, `OVERDUE_MD` — the table is the document's, row for row. */
export function OverdueMdEmail(payload: OverdueMdPayload) {
  return (
    <EmailLayout
      preview={`Overdue: ${payload.jobCode} — ${payload.departmentName} — ${payload.assigneeName}`}
    >
      <Heading>A task has crossed its deadline</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        The following subtask has crossed its deadline and is not yet completed.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          [
            'Part / Drawing',
            [payload.partNumber, payload.drawingNumber].filter(Boolean).join(' / ') || null,
          ],
          ['Department', payload.departmentName],
          ['Assigned to', payload.assigneeName],
          ['Deadline', payload.deadlineIst],
          ['Delay', formatDuration(payload.delayMinutes)],
          ['Current status', payload.status],
        ]}
      />

      <Paragraph>No completion or problem report has been received.</Paragraph>

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open subtask" />
    </EmailLayout>
  );
}

export function ProblemRaisedEmail(payload: ProblemRaisedPayload) {
  return (
    <EmailLayout
      preview={`${payload.severity} problem: ${payload.jobCode} — ${payload.departmentName}`}
    >
      <Heading>A problem has been reported</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        {payload.raisedByName} has reported a{' '}
        <strong style={{ color: COLORS.problem }}>{payload.severity.toLowerCase()}</strong> problem
        on <strong>{payload.subtaskTitle}</strong>.
      </Paragraph>

      {/* The member's own words, verbatim — SDD 5.4. */}
      <Section
        style={{
          backgroundColor: COLORS.background,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          margin: '12px 0',
          padding: 12,
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: 14, lineHeight: '22px', margin: 0 }}>
          {payload.description}
        </Text>
      </Section>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          ['Department', payload.departmentName],
          ['Assigned to', payload.assigneeName],
          ['Deadline', payload.deadlineIst],
        ]}
      />

      <ActionButton href={problemInboxLink()} label="Open problem inbox" />
    </EmailLayout>
  );
}

export function ProblemResolvedEmail(payload: ProblemResolvedPayload) {
  return (
    <EmailLayout preview={`Your problem on ${payload.jobCode} has been dealt with`}>
      <Heading>The MD has dealt with your problem</Heading>
      <Paragraph>Dear {payload.assigneeName},</Paragraph>
      <Paragraph>
        The problem you reported on <strong>{payload.subtaskTitle}</strong> has been resolved.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          ['Decision', payload.action.replace(/_/g, ' ').toLowerCase()],
          ['What the MD said', payload.mdActionNote],
          ['Deadline', payload.deadlineIst],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function ExtensionRequestedEmail(payload: ExtensionRequestedPayload) {
  return (
    <EmailLayout preview={`More time asked for on ${payload.jobCode}`}>
      <Heading>Somebody has asked for more time</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        {payload.requestedByName} has asked to move the deadline on{' '}
        <strong>{payload.subtaskTitle}</strong>.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          ['Department', payload.departmentName],
          ['Current deadline', payload.deadlineIst],
          ['Asked for', payload.requestedDeadlineIst],
          ['Reason', payload.reason],
        ]}
      />

      <ActionButton href={subtaskLink(payload.subtaskId)} label="Open the task" />
    </EmailLayout>
  );
}

export function JobCompletedEmail(payload: JobCompletedPayload) {
  return (
    <EmailLayout preview={`${payload.jobCode} is complete`}>
      <Heading>{payload.jobCode} is complete</Heading>
      <Paragraph>Dear Sir,</Paragraph>
      <Paragraph>
        Every subtask on <strong>{payload.jobTitle}</strong> has been closed.
      </Paragraph>

      <FactTable
        rows={[
          ['Job', `${payload.jobCode} — ${payload.jobTitle}`],
          [
            'Part / Drawing',
            [payload.partNumber, payload.drawingNumber].filter(Boolean).join(' / ') || null,
          ],
          ['Completed', payload.completedIst],
          ['Subtasks', String(payload.subtaskCount)],
          ['On time', payload.onTime ? 'Yes' : 'No — it finished after the deadline'],
        ]}
      />

      <ActionButton href={jobLink(payload.jobId)} label="Open the job" />
    </EmailLayout>
  );
}

/** One section of the digest, rendered only when it has rows. */
function DigestSection({
  title,
  rows,
  emptyText,
  accent,
}: {
  title: string;
  rows: DigestRow[];
  emptyText: string;
  accent?: string;
}) {
  return (
    <Section style={{ marginTop: 20 }}>
      <Text
        style={{
          color: accent ?? COLORS.text,
          fontSize: 15,
          fontWeight: 600,
          margin: '0 0 8px',
        }}
      >
        {title} ({rows.length})
      </Text>

      {rows.length === 0 ? (
        <Text style={{ color: COLORS.muted, fontSize: 14, margin: 0 }}>{emptyText}</Text>
      ) : (
        <table
          cellPadding={0}
          cellSpacing={0}
          style={{ borderCollapse: 'collapse', width: '100%' }}
        >
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.jobCode}-${index}`}>
                <td
                  style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: 13,
                    padding: '8px 8px 8px 0',
                    verticalAlign: 'top',
                  }}
                >
                  <strong>{row.jobCode}</strong>
                  <br />
                  <span style={{ color: COLORS.muted }}>
                    {row.departmentName} · {row.assigneeName}
                  </span>
                </td>
                <td
                  style={{
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: 13,
                    padding: '8px 0',
                    verticalAlign: 'top',
                  }}
                >
                  {row.subtaskTitle}
                  <br />
                  <span style={{ color: COLORS.muted }}>
                    {row.deadlineIst} · {formatDuration(row.minutes)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** FR-56: the 9 AM IST digest. */
export function DailyDigestEmail(payload: DailyDigestPayload) {
  const total = payload.overdue.length + payload.dueToday.length + payload.openProblems.length;

  return (
    <EmailLayout preview={`${payload.dateIst}: ${total} things need your attention`}>
      <Heading>Where things stand — {payload.dateIst}</Heading>
      <Paragraph>Dear Sir,</Paragraph>

      {total === 0 ? (
        <Paragraph>
          Nothing is overdue, nothing is due today, and no problems are open. Everything is on
          track.
        </Paragraph>
      ) : (
        <Paragraph>Here is what needs your attention this morning.</Paragraph>
      )}

      <DigestSection
        title="Overdue"
        rows={payload.overdue}
        emptyText="Nothing is late."
        accent={COLORS.overdue}
      />

      <DigestSection title="Due today" rows={payload.dueToday} emptyText="Nothing due today." />

      <DigestSection
        title="Open problems"
        rows={payload.openProblems}
        emptyText="No problems waiting on a decision."
        accent={COLORS.problem}
      />

      <ActionButton href={problemInboxLink()} label="Open the problem inbox" />
    </EmailLayout>
  );
}
