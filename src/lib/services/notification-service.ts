/**
 * Notification scheduling — the seams M7 fills in.
 *
 * The bodies are deliberately empty today. What matters now is that every place
 * which *must* schedule or cancel a notification already calls the right
 * function, inside the right transaction, with a fully typed payload. When M7
 * implements the bodies the engine switches on without a single caller
 * changing — and, more importantly, without anyone having to rediscover where
 * the calls belong.
 *
 * Every function takes a transaction client, because SDD section 5.1 schedules
 * at write time: the notification rows and the change that caused them must
 * commit together, or a published job could exist with nobody told about it.
 */
import type { NotifType, ProblemSeverity } from '@prisma/client';

import type { Db } from '@/lib/db/prisma';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('notifications');

/**
 * What a queued notification needs to know.
 *
 * `dedupeKey` is the idempotency guarantee of SDD section 5.1 — the unique
 * index on it is what makes a restart mid-sweep harmless. Callers build it, not
 * the sweeper, because only the caller knows what makes this event distinct.
 */
export interface EnqueueInput {
  type: NotifType;
  /** Recipients. One row per user, so each can be read and retried alone. */
  userIds: readonly string[];
  entityType: 'SUBTASK' | 'JOB' | 'PROBLEM';
  entityId: string;
  dedupeKey: string;
  /** Absent means "as soon as the sweeper next runs". */
  scheduledFor?: Date;
  /** Typed context the M7 template renders from. */
  payload: NotificationPayload;
}

/** The context each template needs, discriminated by the notification type. */
export type NotificationPayload =
  | { kind: 'SUBTASK'; subtaskId: string }
  | {
      kind: 'SUBTASK_REASSIGNED';
      subtaskId: string;
      previousAssigneeId: string;
      nextAssigneeId: string;
    }
  | {
      kind: 'DEADLINE_CHANGED';
      subtaskId: string;
      oldDeadline: Date;
      newDeadline: Date;
      reason: string;
    }
  | {
      kind: 'PROBLEM_RAISED';
      problemId: string;
      subtaskId: string;
      severity: ProblemSeverity;
      description: string;
    }
  | {
      kind: 'PROBLEM_RESOLVED';
      problemId: string;
      subtaskId: string;
      action: string;
      mdActionNote: string;
    }
  | { kind: 'JOB'; jobId: string };

/**
 * The single entry point M7 implements.
 *
 * Everything below is a named wrapper over it, so that a caller expresses
 * *what happened* rather than assembling a dedupe key at the call site.
 */
export async function enqueue(_db: Db, input: EnqueueInput): Promise<void> {
  log.debug(
    { type: input.type, entityId: input.entityId, recipients: input.userIds.length },
    'enqueue: no-op until M7',
  );
}

/**
 * Schedules `SUBTASK_ASSIGNED` (now) and `DEADLINE_REMINDER`
 * (`deadline − reminderLeadMinutes`) for a subtask — SDD section 5.1.
 */
export async function scheduleForSubtask(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'scheduleForSubtask: no-op until M7');
}

/**
 * Cancels pending rows for a subtask and schedules fresh ones from the new
 * deadline — SDD section 4.5.
 *
 * The dedupe key includes the deadline epoch, so a new reminder row is created
 * naturally and the old one can never be resurrected.
 */
export async function rescheduleForSubtask(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'rescheduleForSubtask: no-op until M7');
}

/**
 * Deletes still-pending `DEADLINE_REMINDER` and `OVERDUE_*` rows for a subtask.
 *
 * Called when a subtask completes or is cancelled: chasing somebody for work
 * that is already done is exactly what destroys trust in the mails
 * (improvement I-05).
 */
export async function cancelPendingForSubtask(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'cancelPendingForSubtask: no-op until M7');
}

/** Notifies the old and the new assignee of a reassignment (FR-24). */
export async function notifyReassignment(
  db: Db,
  subtaskId: string,
  previousAssigneeId: string,
  nextAssigneeId: string,
): Promise<void> {
  await enqueue(db, {
    type: 'SUBTASK_REASSIGNED',
    userIds: [previousAssigneeId, nextAssigneeId],
    entityType: 'SUBTASK',
    entityId: subtaskId,
    dedupeKey: `subtask:${subtaskId}:REASSIGNED:${nextAssigneeId}:${Date.now()}`,
    payload: { kind: 'SUBTASK_REASSIGNED', subtaskId, previousAssigneeId, nextAssigneeId },
  });
}

/** Notifies the assignee that their deadline moved (FR-55 `DEADLINE_CHANGED`). */
export async function notifyDeadlineChange(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'notifyDeadlineChange: no-op until M7');
}

/**
 * FR-40: an instant mail and in-app notification to the MD and every deputy the
 * moment a problem is raised. This is the hinge of the whole product — a
 * problem that reaches the MD late is one where the cost of recovery is highest.
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
    // One notification per problem per recipient, ever.
    dedupeKey: `problem:${input.problemId}:RAISED`,
    payload: {
      kind: 'PROBLEM_RAISED',
      problemId: input.problemId,
      subtaskId: input.subtaskId,
      severity: input.severity,
      description: input.description,
    },
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
    dedupeKey: `problem:${input.problemId}:RESOLVED`,
    payload: {
      kind: 'PROBLEM_RESOLVED',
      problemId: input.problemId,
      subtaskId: input.subtaskId,
      action: input.action,
      mdActionNote: input.mdActionNote,
    },
  });
}

/** Notifies the MD that a subtask is waiting for approval (FR-25). */
export async function notifyApprovalRequired(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'notifyApprovalRequired: no-op until M7');
}

/**
 * The MD and every deputy — who hears about a problem (FR-40).
 *
 * Loaded here rather than at each call site so the recipient rule has one
 * definition, and so M7 can extend it with `mail.md_recipients` without
 * touching a caller.
 */
export async function problemRecipientIds(db: Db): Promise<string[]> {
  const recipients = await db.user.findMany({
    where: { role: { in: ['MD', 'DEPUTY_MD'] }, isActive: true },
    select: { id: true },
  });
  return recipients.map((row) => row.id);
}
