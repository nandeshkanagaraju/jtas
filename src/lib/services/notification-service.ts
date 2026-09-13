/**
 * Notification scheduling — the seams M7 fills in.
 *
 * These are deliberately no-ops today. They exist now so that every place which
 * *must* schedule or cancel a notification already calls the right function
 * inside the right transaction. When M7 implements the bodies, the notification
 * engine switches on without a single caller changing — and, more importantly,
 * without anyone having to remember where the calls belong.
 *
 * Every function takes a transaction client, because SDD section 5.1 schedules
 * at write time: the notification rows and the change that caused them must
 * commit together, or a published job could exist with nobody told about it.
 */
import type { Db } from '@/lib/db/prisma';
import { moduleLogger } from '@/lib/utils/logger';

const log = moduleLogger('notifications');

/**
 * Schedules `SUBTASK_ASSIGNED` (now) and `DEADLINE_REMINDER`
 * (`deadline − reminderLeadMinutes`) for a subtask — SDD section 5.1.
 *
 * Called on publish and whenever a subtask is added to a published job.
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

/**
 * Notifies the old and the new assignee of a reassignment (FR-24), and the
 * assignee of a deadline change (FR-55).
 */
export async function notifyReassignment(
  _db: Db,
  subtaskId: string,
  _previousAssigneeId: string,
  _nextAssigneeId: string,
): Promise<void> {
  log.debug({ subtaskId }, 'notifyReassignment: no-op until M7');
}

/** Notifies the assignee that their deadline moved (FR-55 `DEADLINE_CHANGED`). */
export async function notifyDeadlineChange(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'notifyDeadlineChange: no-op until M7');
}

/** Notifies the MD and deputies that a problem was raised (FR-40). */
export async function notifyProblemRaised(_db: Db, problemId: string): Promise<void> {
  log.debug({ problemId }, 'notifyProblemRaised: no-op until M7');
}

/** Notifies the MD that a subtask is waiting for approval (FR-25). */
export async function notifyApprovalRequired(_db: Db, subtaskId: string): Promise<void> {
  log.debug({ subtaskId }, 'notifyApprovalRequired: no-op until M7');
}
