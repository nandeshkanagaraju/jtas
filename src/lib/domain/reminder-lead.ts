/**
 * Reminder lead as a person enters it: a whole number plus a unit.
 *
 * The database stores minutes. Hours and days exist only in the control, so
 * "6 hours" and "15 minutes" cannot be confused with each other, and a
 * fraction such as 0.25 is refused rather than stored as a fraction of an hour.
 */
import { formatDuration } from '@/lib/utils/duration';
import { formatIST } from '@/lib/utils/time';

export type ReminderUnit = 'minutes' | 'hours' | 'days';

const UNIT_MINUTES: Record<ReminderUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 24 * 60,
};

/** Subtask lead: 1 minute to 30 days. Settings uses a shorter ceiling. */
export const SUBTASK_LEAD_MAX_MINUTES = 43_200;
export const SETTINGS_LEAD_MAX_MINUTES = 10_080;

export function splitReminderLead(minutes: number): { amount: number; unit: ReminderUnit } {
  if (!Number.isInteger(minutes) || minutes < 1) return { amount: 6, unit: 'hours' };
  if (minutes % UNIT_MINUTES.days === 0)
    return { amount: minutes / UNIT_MINUTES.days, unit: 'days' };
  if (minutes % UNIT_MINUTES.hours === 0) {
    return { amount: minutes / UNIT_MINUTES.hours, unit: 'hours' };
  }
  return { amount: minutes, unit: 'minutes' };
}

/** Minutes represented by a whole amount in the chosen unit, or null when it is not. */
export function minutesFromAmount(amount: string, unit: ReminderUnit): number | null {
  if (!/^[1-9]\d*$/.test(amount.trim())) return null;
  return Number(amount) * UNIT_MINUTES[unit];
}

/**
 * Why this entry cannot be stored, or null when it can.
 *
 * A decimal is a whole-number failure, not a conversion: 0.25 hours is not
 * 15 minutes. The person switches the unit to Minutes and types 15.
 */
export function reminderLeadProblem(
  amount: string,
  unit: ReminderUnit,
  maxMinutes: number,
): string | null {
  const minutes = minutesFromAmount(amount, unit);
  if (minutes === null) return 'Enter a whole number.';
  if (minutes < 1) return 'Give at least 1 minute of warning.';
  if (minutes > maxMinutes) {
    const days = maxMinutes / UNIT_MINUTES.days;
    return Number.isInteger(days)
      ? `That is more than ${days} days.`
      : 'That reminder is too far ahead.';
  }
  return null;
}

/** The same refusal, for a value already stored as minutes. NaN and fractions fail. */
export function reminderLeadMinutesProblem(
  minutes: number,
  maxMinutes = SUBTASK_LEAD_MAX_MINUTES,
): string | null {
  if (!Number.isInteger(minutes)) return 'Enter a whole number.';
  if (minutes < 1) return 'Give at least 1 minute of warning.';
  if (minutes > maxMinutes) {
    const days = maxMinutes / UNIT_MINUTES.days;
    return Number.isInteger(days)
      ? `That is more than ${days} days.`
      : 'That reminder is too far ahead.';
  }
  return null;
}

/** "Reminder 15 minutes before the deadline — 02 Oct 2026, 10:15 AM". */
export function reminderConfirmation(minutes: number, deadline: Date | null): string {
  const lead = formatDuration(minutes);
  if (!deadline || Number.isNaN(deadline.getTime())) {
    return `Reminder ${lead} before the deadline.`;
  }
  const at = new Date(deadline.getTime() - minutes * 60_000);
  return `Reminder ${lead} before the deadline — ${formatIST(at)}`;
}
