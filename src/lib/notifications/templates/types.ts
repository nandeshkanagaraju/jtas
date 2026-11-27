/**
 * Typed payloads for the mail templates — SDD section 5.4.
 *
 * Each payload carries what its template renders and nothing else, so a
 * template cannot quietly start depending on data the sweeper does not load.
 */
import type { ProblemSeverity } from '@prisma/client';

/** Common to every mail: who it is about and where to go. */
export interface JobContext {
  jobCode: string;
  jobTitle: string;
  partNumber: string | null;
  drawingNumber: string | null;
}

export interface SubtaskContext extends JobContext {
  subtaskId: string;
  jobId: string;
  subtaskTitle: string;
  departmentName: string;
  assigneeName: string;
  /** Already formatted in IST, e.g. "13 Sep 2026, 6:00 PM". */
  deadlineIst: string;
  status: string;
}

export interface AssignedPayload extends SubtaskContext {
  kind: 'SUBTASK_ASSIGNED';
  reminderLeadMinutes: number;
}

export interface ReminderPayload extends SubtaskContext {
  kind: 'DEADLINE_REMINDER';
  /** Minutes until the deadline. The subject and the body both format this. */
  minutesLeft: number;
}

export interface OverdueMemberPayload extends SubtaskContext {
  kind: 'OVERDUE_MEMBER';
  delayMinutes: number;
  escalationNumber: number;
}

export interface OverdueMdPayload extends SubtaskContext {
  kind: 'OVERDUE_MD';
  delayMinutes: number;
  escalationNumber: number;
}

export interface ProblemRaisedPayload extends SubtaskContext {
  kind: 'PROBLEM_RAISED';
  problemId: string;
  severity: ProblemSeverity;
  description: string;
  raisedByName: string;
}

export interface ProblemResolvedPayload extends SubtaskContext {
  kind: 'PROBLEM_RESOLVED';
  problemId: string;
  action: string;
  mdActionNote: string;
}

export interface DeadlineChangedPayload extends SubtaskContext {
  kind: 'DEADLINE_CHANGED';
  oldDeadlineIst: string;
  reason: string;
}

export interface ExtensionRequestedPayload extends SubtaskContext {
  kind: 'EXTENSION_REQUESTED';
  requestedDeadlineIst: string;
  reason: string;
  requestedByName: string;
}

export interface ApprovalRequiredPayload extends SubtaskContext {
  kind: 'APPROVAL_REQUIRED';
  completedByName: string;
  completionNote: string | null;
}

/** The department can commit a date. The window closes at `commitmentDueIst`. */
export interface CommitmentOpenPayload extends SubtaskContext {
  kind: 'COMMITMENT_OPEN';
  commitmentDueIst: string;
  minutesLeft: number;
}

/** Six hours before the commitment window closes. */
export interface CommitmentReminderPayload extends SubtaskContext {
  kind: 'COMMITMENT_REMINDER';
  commitmentDueIst: string;
  minutesLeft: number;
}

/** The window closed. The member is told to commit or to report why. */
export interface CommitmentMissedMemberPayload extends SubtaskContext {
  kind: 'COMMITMENT_MISSED_MEMBER';
  commitmentDueIst: string;
  delayMinutes: number;
}

/** The same miss, written for the MD. */
export interface CommitmentMissedMdPayload extends SubtaskContext {
  kind: 'COMMITMENT_MISSED_MD';
  commitmentDueIst: string;
  delayMinutes: number;
}

/** The next department is told a date exists. They are not asked to commit. */
export interface CommitmentMadePayload extends SubtaskContext {
  kind: 'COMMITMENT_MADE';
  readerName: string;
}

/**
 * The MD moved the previous step's date. The next department hears both dates,
 * because that is the date they plan against.
 */
export interface PredecessorDateChangedPayload extends SubtaskContext {
  kind: 'PREDECESSOR_DATE_CHANGED';
  readerName: string;
  oldDeadlineIst: string;
  reason: string;
}

/** The predecessor finished; this assignee can start. */
export interface ReadyToStartPayload extends SubtaskContext {
  kind: 'READY_TO_START';
  predecessorTitle: string;
  predecessorDepartment: string;
  /** The date the previous step committed, when it had one. */
  predecessorDeadlineIst: string | null;
}

export interface JobCompletedPayload extends JobContext {
  kind: 'JOB_COMPLETED';
  jobId: string;
  completedIst: string;
  subtaskCount: number;
  onTime: boolean;
}

export interface DigestRow {
  jobCode: string;
  departmentName: string;
  assigneeName: string;
  subtaskTitle: string;
  deadlineIst: string;
  /** Minutes late, or minutes of problem age. */
  minutes: number;
}

export interface DailyDigestPayload {
  kind: 'DAILY_DIGEST_MD';
  dateIst: string;
  overdue: DigestRow[];
  dueToday: DigestRow[];
  openProblems: Array<DigestRow & { severity: ProblemSeverity; description: string }>;
}

/**
 * An earlier step on the reader's route has a date (option A). The context is
 * the upstream task; `reader*` describes the reader's own step.
 */
export interface UpstreamDateUpdatePayload extends SubtaskContext {
  kind: 'UPSTREAM_DATE_UPDATE';
  readerName: string;
  readerSubtaskId: string;
  readerStepTitle: string;
  readerDepartment: string;
  /** Departments between the upstream step and the reader's, in route order. */
  stepsBetween: string[];
  /** The date before this change, when the MD moved it; null for a first commitment. */
  previousDeadlineIst: string | null;
}

export interface LookaheadRow {
  jobId: string;
  jobCode: string;
  jobTitle: string;
  readerSubtaskId: string;
  readerStepTitle: string;
  /** The step the job is at now, e.g. "Store · In progress". */
  nowAt: string;
  /** How many steps still come before the reader's. */
  stepsAway: number;
  /** When the work is expected to reach the reader, or a reason it is unknown. */
  expectedIst: string;
}

/** The morning "coming your way" mail for one department member (option B). */
export interface DepartmentLookaheadPayload {
  kind: 'DEPARTMENT_LOOKAHEAD';
  dateIst: string;
  readerName: string;
  readerDepartmentName: string;
  rows: LookaheadRow[];
}

/**
 * One department telling another something to act on: a store register line
 * (to Production and Planning), or Planning asking Accounts to invoice.
 */
export interface DepartmentIntimationPayload extends JobContext {
  kind: 'DEPARTMENT_INTIMATION';
  jobId: string;
  readerName: string;
  /** "Store: material received" — also the subject. */
  headline: string;
  /** Label/value pairs, in the order Store or Planning typed them. */
  facts: Array<[string, string | null]>;
  /** Who sent it, e.g. "Hari (Store)". */
  fromName: string;
  sentIst: string;
}

export type TemplatePayload =
  | DepartmentIntimationPayload
  | UpstreamDateUpdatePayload
  | DepartmentLookaheadPayload
  | AssignedPayload
  | ReminderPayload
  | OverdueMemberPayload
  | OverdueMdPayload
  | ProblemRaisedPayload
  | ProblemResolvedPayload
  | DeadlineChangedPayload
  | ExtensionRequestedPayload
  | ApprovalRequiredPayload
  | CommitmentOpenPayload
  | CommitmentReminderPayload
  | CommitmentMissedMemberPayload
  | CommitmentMissedMdPayload
  | CommitmentMadePayload
  | PredecessorDateChangedPayload
  | ReadyToStartPayload
  | JobCompletedPayload
  | DailyDigestPayload;

export type TemplateKind = TemplatePayload['kind'];

/** What a rendered template produces. */
export interface RenderedEmail {
  subject: string;
  html: string;
  /** Plain-text fallback — required, not optional (build spec M7.5). */
  text: string;
}
