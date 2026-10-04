/**
 * Sequential commitment — PDD section 14.2.
 *
 * A department commits when its turn arrives. The window is 24 hours of clock
 * time: it does not pause for the night, a Sunday, or a holiday. The reminder
 * sits 6 hours before the window closes, the same lead the work reminder uses,
 * and it is not held back for working hours.
 */

/** How long a department has to commit once its turn arrives. */
export const COMMITMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long before the window closes the reminder goes out. */
export const COMMITMENT_REMINDER_LEAD_MS = 6 * 60 * 60 * 1000;

export function commitmentDueAt(turnStartedAt: Date): Date {
  return new Date(turnStartedAt.getTime() + COMMITMENT_WINDOW_MS);
}

export function commitmentReminderAt(dueAt: Date): Date {
  return new Date(dueAt.getTime() - COMMITMENT_REMINDER_LEAD_MS);
}
