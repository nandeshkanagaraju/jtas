/**
 * Dedupe keys — SDD section 5.1.
 *
 * The unique index on `Notification.dedupeKey` is the whole idempotency
 * guarantee of the engine. Combined with `INSERT … ON CONFLICT DO NOTHING`, it
 * is what makes a sweeper that dies mid-batch and restarts harmless: the rows
 * it already wrote simply refuse to be written twice.
 *
 * These builders are pure and have no imports for that reason — a key that is
 * even slightly wrong is either a duplicate mail storm or a mail that never
 * goes out, and both destroy trust in the tool.
 */

/**
 * One assignment notice per subtask per person, ever.
 *
 * Keyed on the user rather than the subtask alone because a reassignment has to
 * be able to tell the new assignee, and the old key must not block it.
 */
export function assignedKey(subtaskId: string, userId: string): string {
  return `subtask:${subtaskId}:ASSIGNED:${userId}`;
}

/**
 * One reminder per subtask per *deadline*.
 *
 * The deadline epoch in the key is the single most important detail in the
 * engine. It means a deadline extension naturally produces a different key, so
 * the new reminder is a new row — and the old key can never be resurrected,
 * even if a stale row survived somewhere. SDD 5.1 calls this out explicitly.
 */
export function reminderKey(subtaskId: string, deadline: Date): string {
  return `subtask:${subtaskId}:REMINDER:${deadline.getTime()}`;
}

/**
 * The nth overdue mail to the member (FR-52).
 *
 * `n` is the escalation number, so the first, second and third chase are
 * distinct rows and none of them can repeat.
 */
export function overdueMemberKey(subtaskId: string, escalationNumber: number): string {
  return `subtask:${subtaskId}:OVERDUE_MEMBER:${escalationNumber}`;
}

/**
 * The nth overdue mail to one MD or deputy (FR-53).
 *
 * Carries the recipient as well as the number: two deputies must each get their
 * own row so each can be retried and read independently.
 */
export function overdueMdKey(subtaskId: string, escalationNumber: number, userId: string): string {
  return `subtask:${subtaskId}:OVERDUE_MD:${escalationNumber}:${userId}`;
}

/** One problem alert per recipient, ever (FR-40). */
export function problemRaisedKey(problemId: string, userId: string): string {
  return `problem:${problemId}:RAISED:${userId}`;
}

/** One resolution notice per problem per recipient (FR-43). */
export function problemResolvedKey(problemId: string, userId: string): string {
  return `problem:${problemId}:RESOLVED:${userId}`;
}

/**
 * One digest per person per IST calendar day (FR-56).
 *
 * The date must be the IST one: a digest generated at 09:00 IST is 03:30 UTC,
 * so a UTC date would be right by luck and wrong the moment the digest time
 * moved earlier.
 */
export function digestKey(userId: string, istDateKey: string): string {
  return `digest:${userId}:${istDateKey}`;
}

/** A deadline change notice, keyed on the new deadline so each move tells once. */
export function deadlineChangedKey(subtaskId: string, newDeadline: Date, userId: string): string {
  return `subtask:${subtaskId}:DEADLINE_CHANGED:${newDeadline.getTime()}:${userId}`;
}

/** A reassignment notice, keyed on the pair so a hand-back also notifies. */
export function reassignedKey(subtaskId: string, userId: string, at: Date): string {
  return `subtask:${subtaskId}:REASSIGNED:${userId}:${at.getTime()}`;
}

/** One approval request per subtask per submission. */
export function approvalRequiredKey(subtaskId: string, userId: string, at: Date): string {
  return `subtask:${subtaskId}:APPROVAL_REQUIRED:${userId}:${at.getTime()}`;
}

/** One extension request notice per request per recipient. */
export function extensionRequestedKey(requestId: string, userId: string): string {
  return `extension:${requestId}:REQUESTED:${userId}`;
}

/** One completion notice per job per recipient. */
export function jobCompletedKey(jobId: string, userId: string): string {
  return `job:${jobId}:COMPLETED:${userId}`;
}

/**
 * One "you can start" notice per dependent, per predecessor, per assignee.
 *
 * Keyed on the predecessor as well as the dependent: completing Planning tells
 * Purchase once, and a later completion of a different predecessor is a
 * different mail. A retried request hits the same key and sends nothing twice.
 */
export function readyToStartKey(subtaskId: string, completedId: string, userId: string): string {
  return `subtask:${subtaskId}:READY:${completedId}:${userId}`;
}

/**
 * One mention notification per comment per person (build spec M10.1).
 *
 * Keyed on the comment rather than the subtask, so two comments mentioning the
 * same person are two notifications — and a retried request is still one.
 */
export function commentMentionKey(commentId: string, userId: string): string {
  return `comment:${commentId}:MENTION:${userId}`;
}
