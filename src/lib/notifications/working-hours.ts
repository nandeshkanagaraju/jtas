/**
 * Working-hour shifting — SDD section 5.3, PDD improvement I-06.
 *
 * "A 2 AM reminder is noise." Reminders, assignment notices and the daily
 * digest wait for the next working slot; overdue mails and problem alerts never
 * do, because they are urgent by definition.
 *
 * Every calculation is in Asia/Kolkata. The decision function is pure and takes
 * its configuration as an argument so the whole matrix — after hours, before
 * hours, weekends, holidays, a holiday followed by a Sunday, and the midnight
 * edges — can be tested without a database.
 */
import {
  istDateKey,
  istDayOfWeek,
  istMinutesOfDay,
  istTimeOnDay,
  parseClockTime,
} from '@/lib/utils/time';

export interface WorkingHoursConfig {
  /** Minutes since IST midnight, e.g. 540 for 09:00. */
  startMinutes: number;
  endMinutes: number;
  /** JS day numbers that are worked, 0 = Sunday. Seeded as Mon–Sat. */
  workingDays: readonly number[];
  /** IST date keys (`yyyy-MM-dd`) that are holidays. */
  holidays: ReadonlySet<string>;
}

/** SDD section 3.4 defaults, used when a setting is missing or malformed. */
export const DEFAULT_WORKING_HOURS: WorkingHoursConfig = {
  startMinutes: 9 * 60,
  endMinutes: 18 * 60,
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: new Set(),
};

/** Builds a config from raw setting values, falling back per field. */
export function toWorkingHoursConfig(input: {
  start?: string;
  end?: string;
  workingDays?: unknown;
  holidays?: Iterable<string>;
}): WorkingHoursConfig {
  let startMinutes = DEFAULT_WORKING_HOURS.startMinutes;
  let endMinutes = DEFAULT_WORKING_HOURS.endMinutes;

  try {
    if (input.start) startMinutes = parseClockTime(input.start);
    if (input.end) endMinutes = parseClockTime(input.end);
  } catch {
    // A malformed clock setting must not take the scheduler down; the seeded
    // defaults are always sane.
    startMinutes = DEFAULT_WORKING_HOURS.startMinutes;
    endMinutes = DEFAULT_WORKING_HOURS.endMinutes;
  }

  // A start at or after the end would make every day unworkable and push every
  // reminder forward forever.
  if (startMinutes >= endMinutes) {
    startMinutes = DEFAULT_WORKING_HOURS.startMinutes;
    endMinutes = DEFAULT_WORKING_HOURS.endMinutes;
  }

  const days = Array.isArray(input.workingDays)
    ? input.workingDays.filter(
        (day): day is number => typeof day === 'number' && day >= 0 && day <= 6,
      )
    : [];

  return {
    startMinutes,
    endMinutes,
    workingDays: days.length > 0 ? days : DEFAULT_WORKING_HOURS.workingDays,
    holidays: new Set(input.holidays ?? []),
  };
}

/** How far ahead the search will look before giving up. */
const MAX_LOOKAHEAD_DAYS = 60;

/**
 * True when `instant` falls on a worked, non-holiday IST day.
 *
 * Both the weekday and the holiday lookup use the IST calendar day, so an
 * instant late on a UTC Saturday that is already Sunday in Coimbatore is
 * correctly treated as the weekly off.
 */
export function isWorkingDay(instant: Date, config: WorkingHoursConfig): boolean {
  if (!config.workingDays.includes(istDayOfWeek(instant))) return false;
  return !config.holidays.has(istDateKey(instant));
}

/** True when `instant` is inside working hours on a working day. */
export function isWithinWorkingHours(instant: Date, config: WorkingHoursConfig): boolean {
  if (!isWorkingDay(instant, config)) return false;

  const minutes = istMinutesOfDay(instant);
  return minutes >= config.startMinutes && minutes < config.endMinutes;
}

/**
 * The first moment at or after `instant` that falls inside working hours.
 *
 * Returns `instant` unchanged when it is already inside them — a reminder due
 * at 11 AM on a Tuesday is not delayed.
 *
 * Otherwise:
 *  - before the working day starts → the same day's start;
 *  - after it ends, or on a non-working day, or on a holiday → the start of the
 *    next working day, skipping as many closed days in a row as it takes.
 */
export function nextWorkingSlot(
  instant: Date,
  config: WorkingHoursConfig = DEFAULT_WORKING_HOURS,
): Date {
  if (isWithinWorkingHours(instant, config)) return instant;

  // Same day, before opening: wait for the start rather than a whole day.
  if (isWorkingDay(instant, config) && istMinutesOfDay(instant) < config.startMinutes) {
    return istTimeOnDay(instant, config.startMinutes);
  }

  for (let offset = 1; offset <= MAX_LOOKAHEAD_DAYS; offset++) {
    const candidate = istTimeOnDay(instant, config.startMinutes, offset);
    if (isWorkingDay(candidate, config)) return candidate;
  }

  /*
   * Unreachable with any sane configuration — sixty consecutive closed days
   * would mean the factory is shut for two months. Returning the instant
   * unchanged is the safe failure: the mail goes out at an awkward hour rather
   * than never going out at all.
   */
  return instant;
}

/**
 * Which notification types wait for working hours (SDD 5.3).
 *
 * Overdue mails and problem alerts are deliberately absent: an overdue task at
 * 2 AM is still overdue, and a blocker that waits until 9 AM has cost the
 * factory a shift.
 */
export const SUPPRESSIBLE_TYPES = [
  'SUBTASK_ASSIGNED',
  'DEADLINE_REMINDER',
  'DAILY_DIGEST_MD',
] as const;

export function isSuppressible(type: string): boolean {
  return (SUPPRESSIBLE_TYPES as readonly string[]).includes(type);
}
