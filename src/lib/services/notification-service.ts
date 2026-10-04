/**
 * The seams M4 and M6 call, now backed by the real engine.
 *
 * This file deliberately survived M7 rather than being deleted: every call site
 * built in earlier modules already sits inside the right transaction, and
 * keeping the same function names means switching the engine on changed no
 * caller at all. The bodies simply stopped being no-ops.
 *
 * Every function takes a transaction client, because SDD section 5.1 schedules
 * at write time — the notification rows and the change that caused them commit
 * together, or a published job could exist with nobody told about it.
 */
import type { ProblemSeverity } from '@prisma/client';

import type { Db } from '@/lib/db/prisma';
import {
  approvalRequiredKey,
  commitmentMadeKey,
  deadlineChangedKey,
  extensionRequestedKey,
  jobCompletedKey,
  problemRaisedKey,
  problemResolvedKey,
  readyToStartKey,
  reassignedKey,
} from '@/lib/notifications/dedupe';
import {
  cancelForSubtask,
  enqueue,
  rescheduleForSubtask as rescheduleImpl,
  scheduleForSubtask as scheduleImpl,
} from '@/lib/notifications/notification-service';

/**
 * Schedules `SUBTASK_ASSIGNED` (now) and `DEADLINE_REMINDER`
 * (`deadline − reminderLeadMinutes`) — SDD section 5.1.
 */
export async function scheduleForSubtask(db: Db, subtaskId: string): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: {
      id: true,
      assigneeId: true,
      deadline: true,
      reminderLeadMinutes: true,
      commitmentDueAt: true,
    },
  });
  if (!subtask) return;

  await scheduleImpl(db, subtask);
}

/** Cancels pending rows and schedules fresh ones — SDD section 4.5. */
export async function rescheduleForSubtask(db: Db, subtaskId: string): Promise<void> {
  await rescheduleImpl(db, subtaskId);
}

/**
 * Deletes still-pending rows for a subtask.
 *
 * Called when a subtask completes or is cancelled: chasing somebody for work
 * that is already done is exactly what destroys trust in the mails (I-05).
 */
export async function cancelPendingForSubtask(db: Db, subtaskId: string): Promise<void> {
  await cancelForSubtask(db, subtaskId);
}

/** Tells the old and the new assignee about a reassignment (FR-24). */
export async function notifyReassignment(
  db: Db,
  subtaskId: string,
  previousAssigneeId: string,
  nextAssigneeId: string,
): Promise<void> {
  const at = new Date();

  await enqueue(db, {
    type: 'SUBTASK_REASSIGNED',
    userIds: [previousAssigneeId, nextAssigneeId],
    entityType: 'SUBTASK',
    entityId: subtaskId,
    subject: 'A task has changed hands',
    body: 'A subtask you are involved with has been reassigned.',
    dedupeKeyFor: (userId) => reassignedKey(subtaskId, userId, at),
  });
}

/** Tells the assignee their deadline moved (FR-55). */
export async function notifyDeadlineChange(db: Db, subtaskId: string): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: { assigneeId: true, deadline: true, title: true },
  });
  if (!subtask?.deadline) return;
  const deadline = subtask.deadline;

  await enqueue(db, {
    type: 'DEADLINE_CHANGED',
    userIds: [subtask.assigneeId],
    entityType: 'SUBTASK',
    entityId: subtaskId,
    subject: 'Your deadline has changed',
    body: `The deadline for ${subtask.title} has been changed.`,
    dedupeKeyFor: (userId) => deadlineChangedKey(subtaskId, deadline, userId),
  });
}

/**
 * FR-40: an instant alert to the MD and every deputy.
 *
 * Never working-hour shifted — a blocker that waits until 9 AM has cost the
 * factory a shift.
 */
export async function notifyProblemRaised(
  db: Db,
  input: {
    problemId: string;
    subtaskId: string;
    severity: ProblemSeverity;
    description: string;
    recipientIds: readonly string[];
  },
): Promise<void> {
  await enqueue(db, {
    type: 'PROBLEM_RAISED',
    userIds: input.recipientIds,
    entityType: 'PROBLEM',
    entityId: input.problemId,
    subject: `${input.severity} problem reported`,
    body: input.description,
    dedupeKeyFor: (userId) => problemRaisedKey(input.problemId, userId),
  });
}

/** FR-43: the member hears the MD's decision. */
export async function notifyProblemResolved(
  db: Db,
  input: {
    problemId: string;
    subtaskId: string;
    assigneeId: string;
    action: string;
    mdActionNote: string;
  },
): Promise<void> {
  await enqueue(db, {
    type: 'PROBLEM_RESOLVED',
    userIds: [input.assigneeId],
    entityType: 'PROBLEM',
    entityId: input.problemId,
    subject: 'The MD has dealt with your problem',
    body: input.mdActionNote,
    dedupeKeyFor: (userId) => problemResolvedKey(input.problemId, userId),
  });
}

/** FR-25: the MD is told a subtask is waiting for approval. */
export async function notifyApprovalRequired(db: Db, subtaskId: string): Promise<void> {
  const recipients = await problemRecipientIds(db);
  if (recipients.length === 0) return;

  const at = new Date();

  await enqueue(db, {
    type: 'APPROVAL_REQUIRED',
    userIds: recipients,
    entityType: 'SUBTASK',
    entityId: subtaskId,
    subject: 'A task is waiting for your approval',
    body: 'A member has marked a task completed and it needs your approval.',
    dedupeKeyFor: (userId) => approvalRequiredKey(subtaskId, userId, at),
  });
}

/** FR-33: the MD is told somebody asked for more time. */
export async function notifyExtensionRequested(db: Db, extensionRequestId: string): Promise<void> {
  const recipients = await problemRecipientIds(db);
  if (recipients.length === 0) return;

  await enqueue(db, {
    type: 'EXTENSION_REQUESTED',
    userIds: recipients,
    entityType: 'SUBTASK',
    entityId: extensionRequestId,
    subject: 'Somebody has asked for more time',
    body: 'A member has asked to move a deadline.',
    dedupeKeyFor: (userId) => extensionRequestedKey(extensionRequestId, userId),
  });
}

/**
 * Tells the assignee of the next task that a date was committed, so they can
 * prepare. They are not asked to commit yet. Their own window starts when
 * this task is completed and they are unblocked.
 */
export async function notifyCommitmentMade(db: Db, subtaskId: string): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: { deadline: true, title: true },
  });
  if (!subtask?.deadline) return;

  const next = await db.subtask.findMany({
    where: { dependsOnId: subtaskId },
    select: { assigneeId: true },
  });
  if (next.length === 0) return;

  const deadline = subtask.deadline;

  await enqueue(db, {
    type: 'COMMITMENT_MADE',
    userIds: next.map((row) => row.assigneeId),
    entityType: 'SUBTASK',
    entityId: subtaskId,
    subject: 'The previous department committed a date',
    body: `${subtask.title} has a finish date. You are next.`,
    dedupeKeyFor: (userId) => commitmentMadeKey(subtaskId, deadline, userId),
  });
}

/**
 * Tells the assignee of a subtask that its predecessor has finished and they
 * can start.
 *
 * Queued in the same transaction as the unblock. A completion that committed
 * without this row would leave the next department waiting to be told.
 */
export async function notifyReadyToStart(
  db: Db,
  subtaskId: string,
  completedId: string,
): Promise<void> {
  const subtask = await db.subtask.findUnique({
    where: { id: subtaskId },
    select: { assigneeId: true },
  });
  if (!subtask) return;

  await enqueue(db, {
    type: 'READY_TO_START',
    userIds: [subtask.assigneeId],
    entityType: 'SUBTASK',
    entityId: subtaskId,
    subject: 'You can start',
    body: 'The previous step is complete. You can start your task.',
    dedupeKeyFor: (userId) => readyToStartKey(subtaskId, completedId, userId),
  });
}

/** Tells the MD and deputies that a job finished. */
export async function notifyJobCompleted(db: Db, jobId: string): Promise<void> {
  const recipients = await problemRecipientIds(db);
  if (recipients.length === 0) return;

  await enqueue(db, {
    type: 'JOB_COMPLETED',
    userIds: recipients,
    entityType: 'JOB',
    entityId: jobId,
    subject: 'A job is complete',
    body: 'Every subtask on this job has been closed.',
    dedupeKeyFor: (userId) => jobCompletedKey(jobId, userId),
  });
}

/**
 * The MD and every active deputy.
 *
 * One definition, so M7 can later extend it with `mail.md_recipients` without
 * touching a caller.
 */
export async function problemRecipientIds(db: Db): Promise<string[]> {
  const recipients = await db.user.findMany({
    where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true },
    select: { id: true },
  });
  return recipients.map((row) => row.id);
}

export { enqueue } from '@/lib/notifications/notification-service';
