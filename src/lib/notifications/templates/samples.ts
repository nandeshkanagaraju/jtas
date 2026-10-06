/**
 * Sample payloads for the preview route and the template tests.
 *
 * Realistic rather than lorem ipsum: a template that looks fine with "Test
 * Title" and breaks on "Machining, setup approval and first-piece clearance" is
 * a template nobody checked properly.
 */
import type { TemplateKind, TemplatePayload } from './types';

const SUBTASK = {
  subtaskId: 'sub-demo-1',
  jobId: 'job-demo-1',
  jobCode: 'JGE-2026-0042',
  jobTitle: 'Spindle housing batch',
  partNumber: 'SH-4410',
  drawingNumber: 'DRG-4410-B',
  subtaskTitle: 'Machining, setup approval and first-piece clearance',
  departmentName: 'Production',
  assigneeName: 'Ravi Kumar',
  deadlineIst: '13 Sep 2026, 6:00 PM',
  status: 'in progress',
};

export const SAMPLES: Record<TemplateKind, TemplatePayload> = {
  SUBTASK_ASSIGNED: { kind: 'SUBTASK_ASSIGNED', ...SUBTASK, reminderLeadMinutes: 360 },
  DEADLINE_REMINDER: { kind: 'DEADLINE_REMINDER', ...SUBTASK, minutesLeft: 360 },
  OVERDUE_MEMBER: {
    kind: 'OVERDUE_MEMBER',
    ...SUBTASK,
    delayMinutes: 14 * 60,
    escalationNumber: 1,
  },
  OVERDUE_MD: { kind: 'OVERDUE_MD', ...SUBTASK, delayMinutes: 14 * 60, escalationNumber: 1 },
  PROBLEM_RAISED: {
    kind: 'PROBLEM_RAISED',
    ...SUBTASK,
    problemId: 'prob-demo-1',
    severity: 'BLOCKER',
    description:
      'Material short by 12 bars. The supplier has not confirmed a delivery date and the setup cannot start without EN8 40 mm stock.',
    raisedByName: 'Ravi Kumar',
  },
  PROBLEM_RESOLVED: {
    kind: 'PROBLEM_RESOLVED',
    ...SUBTASK,
    problemId: 'prob-demo-1',
    action: 'EXTEND',
    mdActionNote: 'Supplier confirmed 14 September. Four extra days agreed with the customer.',
  },
  DEADLINE_CHANGED: {
    kind: 'DEADLINE_CHANGED',
    ...SUBTASK,
    oldDeadlineIst: '13 Sep 2026, 6:00 PM',
    reason: 'Customer moved the collection date.',
  },
  EXTENSION_REQUESTED: {
    kind: 'EXTENSION_REQUESTED',
    ...SUBTASK,
    requestedDeadlineIst: '17 Sep 2026, 6:00 PM',
    reason: 'The tooling supplier has slipped by four days.',
    requestedByName: 'Ravi Kumar',
  },
  APPROVAL_REQUIRED: {
    kind: 'APPROVAL_REQUIRED',
    ...SUBTASK,
    completedByName: 'Ravi Kumar',
    completionNote: 'First piece cleared, report filed with Quality.',
  },
  COMMITMENT_OPEN: {
    kind: 'COMMITMENT_OPEN',
    ...SUBTASK,
    deadlineIst: 'Not committed',
    commitmentDueIst: '7 Oct 2026, 10:00 AM',
    minutesLeft: 24 * 60,
  },
  COMMITMENT_REMINDER: {
    kind: 'COMMITMENT_REMINDER',
    ...SUBTASK,
    deadlineIst: 'Not committed',
    commitmentDueIst: '7 Oct 2026, 10:00 AM',
    minutesLeft: 6 * 60,
  },
  COMMITMENT_MISSED_MEMBER: {
    kind: 'COMMITMENT_MISSED_MEMBER',
    ...SUBTASK,
    deadlineIst: 'Not committed',
    commitmentDueIst: '7 Oct 2026, 10:00 AM',
    delayMinutes: 60,
  },
  COMMITMENT_MISSED_MD: {
    kind: 'COMMITMENT_MISSED_MD',
    ...SUBTASK,
    deadlineIst: 'Not committed',
    commitmentDueIst: '7 Oct 2026, 10:00 AM',
    delayMinutes: 60,
  },
  COMMITMENT_MADE: {
    kind: 'COMMITMENT_MADE',
    ...SUBTASK,
    readerName: 'Store keeper',
  },
  PREDECESSOR_DATE_CHANGED: {
    kind: 'PREDECESSOR_DATE_CHANGED',
    ...SUBTASK,
    readerName: 'Store keeper',
    oldDeadlineIst: '6 Sep 2026, 6:00 PM',
    reason: 'Material will be a week late.',
  },
  READY_TO_START: {
    kind: 'READY_TO_START',
    ...SUBTASK,
    predecessorTitle: 'Raise PO for raw material and bought-out items',
    predecessorDepartment: 'Purchase',
    predecessorDeadlineIst: '12 Sep 2026, 6:00 PM',
  },
  JOB_COMPLETED: {
    kind: 'JOB_COMPLETED',
    jobId: 'job-demo-1',
    jobCode: 'JGE-2026-0042',
    jobTitle: 'Spindle housing batch',
    partNumber: 'SH-4410',
    drawingNumber: 'DRG-4410-B',
    completedIst: '15 Sep 2026, 4:20 PM',
    subtaskCount: 8,
    onTime: true,
  },
  DAILY_DIGEST_MD: {
    kind: 'DAILY_DIGEST_MD',
    dateIst: '13 Sep 2026',
    overdue: [
      {
        jobCode: 'JGE-2026-0042',
        departmentName: 'Production',
        assigneeName: 'Ravi Kumar',
        subtaskTitle: 'Machining, setup approval and first-piece clearance',
        deadlineIst: '12 Sep 2026, 6:00 PM',
        minutes: 20 * 60,
      },
    ],
    dueToday: [
      {
        jobCode: 'JGE-2026-0043',
        departmentName: 'Quality',
        assigneeName: 'Anita Sharma',
        subtaskTitle: 'Final inspection and inspection report',
        deadlineIst: '13 Sep 2026, 6:00 PM',
        minutes: 8 * 60,
      },
    ],
    openProblems: [
      {
        jobCode: 'JGE-2026-0042',
        departmentName: 'Store',
        assigneeName: 'Bala Krishnan',
        subtaskTitle: 'Receive, inspect and issue material to shop floor',
        deadlineIst: '12 Sep 2026, 6:00 PM',
        minutes: 26 * 60,
        severity: 'BLOCKER',
        description: 'Material short by 12 bars, supplier unconfirmed.',
      },
    ],
  },
};
