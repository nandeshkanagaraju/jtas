/**
 * Rendering a payload into a sendable mail — SDD section 5.4.
 *
 * Every template produces HTML *and* a plain-text fallback. The fallback is not
 * decoration: some shop-floor phones strip HTML, corporate filters score
 * text-less mail as spam, and the plain version is what a screen reader gets.
 * Subjects are the SDD's, verbatim where the document gives them.
 */
import { plainTextSelectors, render } from '@react-email/render';

import { formatElapsed } from '@/lib/utils/duration';

import { jobLink, problemInboxLink, subtaskLink } from './links';
import {
  ApprovalRequiredEmail,
  CommitmentMadeEmail,
  CommitmentMissedMdEmail,
  CommitmentMissedMemberEmail,
  CommitmentOpenEmail,
  CommitmentReminderEmail,
  DeadlineChangedEmail,
  DeadlineReminderEmail,
  OverdueMemberEmail,
  ReadyToStartEmail,
  SubtaskAssignedEmail,
} from './subtask-mails';
import {
  DailyDigestEmail,
  ExtensionRequestedEmail,
  JobCompletedEmail,
  OverdueMdEmail,
  ProblemRaisedEmail,
  ProblemResolvedEmail,
} from './md-mails';
import type { RenderedEmail, TemplateKind, TemplatePayload } from './types';

/** Subject lines. The four the SDD quotes are reproduced exactly. */
function subjectFor(payload: TemplatePayload): string {
  switch (payload.kind) {
    case 'SUBTASK_ASSIGNED':
      return `[JTAS] New task: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'DEADLINE_REMINDER':
      return `[JTAS] Due in ${formatElapsed(payload.minutesLeft)}: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'OVERDUE_MEMBER':
      return `[JTAS] Please complete: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'OVERDUE_MD':
      return `[JTAS] Overdue: ${payload.jobCode} – ${payload.departmentName} – ${payload.assigneeName}`;
    case 'PROBLEM_RAISED':
      return `[JTAS] ${payload.severity} problem: ${payload.jobCode} – ${payload.departmentName}`;
    case 'PROBLEM_RESOLVED':
      return `[JTAS] Problem dealt with: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'DEADLINE_CHANGED':
      return `[JTAS] New deadline: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'EXTENSION_REQUESTED':
      return `[JTAS] More time asked for: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'APPROVAL_REQUIRED':
      return `[JTAS] Approval needed: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'COMMITMENT_OPEN':
      return `[JTAS] You can commit: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'COMMITMENT_REMINDER':
      return `[JTAS] Commit a date by ${payload.commitmentDueIst}: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'COMMITMENT_MISSED_MEMBER':
      return `[JTAS] Commit a date: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'COMMITMENT_MISSED_MD':
      return `[JTAS] Commitment missed: ${payload.jobCode} – ${payload.departmentName} – ${payload.assigneeName}`;
    case 'COMMITMENT_MADE':
      return `[JTAS] Next up: ${payload.jobCode} – ${payload.departmentName} committed ${payload.deadlineIst}`;
    case 'READY_TO_START':
      return `[JTAS] You can start: ${payload.jobCode} – ${payload.subtaskTitle}`;
    case 'JOB_COMPLETED':
      return `[JTAS] Completed: ${payload.jobCode} – ${payload.jobTitle}`;
    case 'DAILY_DIGEST_MD':
      return `[JTAS] Daily summary – ${payload.dateIst}`;
  }
}

/** The React element for a payload. */
function elementFor(payload: TemplatePayload): React.ReactElement {
  switch (payload.kind) {
    case 'SUBTASK_ASSIGNED':
      return <SubtaskAssignedEmail {...payload} />;
    case 'DEADLINE_REMINDER':
      return <DeadlineReminderEmail {...payload} />;
    case 'OVERDUE_MEMBER':
      return <OverdueMemberEmail {...payload} />;
    case 'OVERDUE_MD':
      return <OverdueMdEmail {...payload} />;
    case 'PROBLEM_RAISED':
      return <ProblemRaisedEmail {...payload} />;
    case 'PROBLEM_RESOLVED':
      return <ProblemResolvedEmail {...payload} />;
    case 'DEADLINE_CHANGED':
      return <DeadlineChangedEmail {...payload} />;
    case 'EXTENSION_REQUESTED':
      return <ExtensionRequestedEmail {...payload} />;
    case 'APPROVAL_REQUIRED':
      return <ApprovalRequiredEmail {...payload} />;
    case 'COMMITMENT_OPEN':
      return <CommitmentOpenEmail {...payload} />;
    case 'COMMITMENT_REMINDER':
      return <CommitmentReminderEmail {...payload} />;
    case 'COMMITMENT_MISSED_MEMBER':
      return <CommitmentMissedMemberEmail {...payload} />;
    case 'COMMITMENT_MISSED_MD':
      return <CommitmentMissedMdEmail {...payload} />;
    case 'COMMITMENT_MADE':
      return <CommitmentMadeEmail {...payload} />;
    case 'READY_TO_START':
      return <ReadyToStartEmail {...payload} />;
    case 'JOB_COMPLETED':
      return <JobCompletedEmail {...payload} />;
    case 'DAILY_DIGEST_MD':
      return <DailyDigestEmail {...payload} />;
  }
}

/**
 * Plain-text conversion options.
 *
 * The default selector list flattens a `<table>` into one unbroken line, which
 * turns every fact table — job, part, department, deadline — into
 * "JobJGE-2026-0042Part / DrawingSH-4410DepartmentProduction". The people most
 * likely to read the text part are the ones on a locked-down phone client, and
 * an overdue alert is not the mail to make them decode. `dataTable` keeps the
 * rows as rows.
 */
const PLAIN_TEXT_OPTIONS = {
  selectors: [...plainTextSelectors, { selector: 'table', format: 'dataTable' }],
} as const;

/** Renders the HTML and its plain-text twin. */
export async function renderTemplate(payload: TemplatePayload): Promise<RenderedEmail> {
  const element = elementFor(payload);

  const [html, text] = await Promise.all([
    render(element, { pretty: false }),
    // React Email's own text renderer, so the fallback cannot drift from the
    // HTML the way a hand-written duplicate would.
    render(element, { plainText: true, htmlToTextOptions: PLAIN_TEXT_OPTIONS }),
  ]);

  return { subject: subjectFor(payload), html, text: `${text.trim()}\n\n${linkLine(payload)}` };
}

/**
 * The plain-text link footer.
 *
 * A text-only client renders a button as bare words, so the URL has to appear
 * literally or the mail becomes a dead end (improvement I-14).
 */
function linkLine(payload: TemplatePayload): string {
  switch (payload.kind) {
    case 'DEADLINE_REMINDER':
      return `Mark completed: ${subtaskLink(payload.subtaskId, 'complete')}\nReport problem: ${subtaskLink(payload.subtaskId, 'problem')}`;
    case 'OVERDUE_MEMBER':
      return `Update the task: ${subtaskLink(payload.subtaskId, 'complete')}`;
    case 'PROBLEM_RAISED':
    case 'DAILY_DIGEST_MD':
      return `Problem inbox: ${problemInboxLink()}`;
    case 'JOB_COMPLETED':
      return `Open the job: ${jobLink(payload.jobId)}`;
    default:
      return `Open the task: ${subtaskLink(payload.subtaskId)}`;
  }
}

export const TEMPLATE_KINDS: TemplateKind[] = [
  'SUBTASK_ASSIGNED',
  'DEADLINE_REMINDER',
  'OVERDUE_MEMBER',
  'OVERDUE_MD',
  'PROBLEM_RAISED',
  'PROBLEM_RESOLVED',
  'DEADLINE_CHANGED',
  'EXTENSION_REQUESTED',
  'APPROVAL_REQUIRED',
  'COMMITMENT_OPEN',
  'COMMITMENT_REMINDER',
  'COMMITMENT_MISSED_MEMBER',
  'COMMITMENT_MISSED_MD',
  'COMMITMENT_MADE',
  'READY_TO_START',
  'JOB_COMPLETED',
  'DAILY_DIGEST_MD',
];

export * from './types';
export { subjectFor };
