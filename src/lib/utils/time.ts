/**
 * Timezone discipline for JTAS (SDD section 4.6).
 *
 * Rule: every `Date` that crosses a service or database boundary is an absolute
 * instant, stored and compared in UTC. `Asia/Kolkata` is applied only at two
 * edges — rendering a timestamp for a human, and interpreting a wall-clock
 * string a human typed. Nothing in between is allowed to depend on the
 * server's own timezone.
 *
 * IST is UTC+05:30 year round with no daylight saving, which is why the
 * business-hours maths elsewhere can treat an IST calendar day as a fixed
 * offset window.
 */
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** The single timezone the business operates in. */
export const IST = 'Asia/Kolkata';

/** Default display pattern: `13 Sep 2026, 04:30 PM`. */
export const IST_DISPLAY_PATTERN = 'dd MMM yyyy, hh:mm a';

/** Date-only display pattern: `13 Sep 2026`. */
export const IST_DATE_PATTERN = 'dd MMM yyyy';

/**
 * Shifts an instant into a `Date` whose *local* fields read as IST wall-clock
 * time. Use only for calendar arithmetic (which day is it in Mumbai, what hour
 * of the working day is this). The result is deliberately not a valid instant
 * and must never be persisted — pair it with {@link fromISTWallClock} to get
 * back to UTC.
 */
export function toIST(date: Date): Date {
  return toZonedTime(date, IST);
}

/**
 * Inverse of {@link toIST}: treats the local fields of `wallClock` as IST and
 * returns the real UTC instant.
 */
export function fromISTWallClock(wallClock: Date): Date {
  return fromZonedTime(wallClock, IST);
}

/**
 * Parses a naive wall-clock string the user typed — `2026-09-13T16:30` from a
 * `datetime-local` input, or `2026-09-13 16:30` — as IST, and returns the UTC
 * instant.
 *
 * This is the *only* sanctioned way to build a deadline from user input on the
 * server. `new Date('2026-09-13T16:30')` would resolve against the server's
 * timezone and silently produce a deadline 5.5 hours out in production.
 *
 * A string carrying its own offset or a `Z` suffix is already unambiguous and
 * is rejected here, so that callers do not accidentally double-convert it —
 * pass those to {@link parseInstant} instead.
 *
 * @throws {RangeError} if the input is not a naive `YYYY-MM-DDTHH:mm[:ss]` string.
 */
export function fromISTInput(input: string): Date {
  const trimmed = input.trim();
  const naive = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);

  if (!naive) {
    if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
      throw new RangeError(
        `fromISTInput received "${input}", which already carries a UTC offset. ` +
          'Use parseInstant() for offset-qualified input.',
      );
    }
    throw new RangeError(
      `fromISTInput expects a naive "YYYY-MM-DDTHH:mm" IST wall-clock string, got "${input}".`,
    );
  }

  const utc = fromZonedTime(trimmed.replace(' ', 'T'), IST);
  if (Number.isNaN(utc.getTime())) {
    throw new RangeError(`fromISTInput could not parse "${input}" as a calendar date.`);
  }
  return utc;
}

/**
 * Parses an ISO-8601 string that carries its own offset (`...Z` or `...+05:30`)
 * into a UTC instant. This is what API request bodies send.
 *
 * @throws {RangeError} if the string has no offset, or is not a valid date.
 */
export function parseInstant(input: string): Date {
  const trimmed = input.trim();
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    throw new RangeError(
      `parseInstant expects an offset-qualified ISO-8601 string, got "${input}". ` +
        'Use fromISTInput() for naive IST wall-clock input.',
    );
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`parseInstant could not parse "${input}".`);
  }
  return parsed;
}

/**
 * Renders a UTC instant in IST. Always use this instead of `toLocaleString`,
 * which would follow the viewer's or the server's timezone.
 */
export function formatIST(date: Date, pattern: string = IST_DISPLAY_PATTERN): string {
  return formatInTimeZone(date, IST, pattern);
}

/** `2026-09-13` — the IST calendar date of an instant. Used as a map key. */
export function istDateKey(date: Date): string {
  return formatInTimeZone(date, IST, 'yyyy-MM-dd');
}

/** ISO weekday of an instant in IST: 0 = Sunday … 6 = Saturday. */
export function istDayOfWeek(date: Date): number {
  return toZonedTime(date, IST).getDay();
}

/** Minutes since IST midnight, e.g. `09:30` → 570. Used for working-hour checks. */
export function istMinutesOfDay(date: Date): number {
  const ist = toZonedTime(date, IST);
  return ist.getHours() * 60 + ist.getMinutes();
}

/**
 * Signed hours from `a` to `b`, as a float. Positive when `b` is later.
 * Timezone-independent — both arguments are absolute instants.
 */
export function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000;
}

/** Signed minutes from `a` to `b`, as a float. Positive when `b` is later. */
export function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/** `date` shifted by `minutes`. Negative values move backwards. */
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** `date` shifted by `hours`. Negative values move backwards. */
export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/**
 * Parses an `"HH:mm"` setting value (e.g. `working_hours.start`) into minutes
 * since midnight.
 *
 * @throws {RangeError} on anything that is not a real 24-hour clock time.
 */
export function parseClockTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new RangeError(`Expected an "HH:mm" clock time, got "${value}".`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new RangeError(`"${value}" is not a valid 24-hour clock time.`);
  }
  return hours * 60 + minutes;
}

/**
 * The UTC instant of `minutesOfDay` on the IST calendar day that `reference`
 * falls on, optionally `dayOffset` days later.
 *
 * Built by formatting the IST date and re-parsing it through
 * {@link fromISTWallClock}, so it never depends on the server's timezone.
 */
export function istTimeOnDay(reference: Date, minutesOfDay: number, dayOffset = 0): Date {
  const ist = toZonedTime(reference, IST);
  const day = new Date(
    ist.getFullYear(),
    ist.getMonth(),
    ist.getDate() + dayOffset,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
    0,
    0,
  );
  return fromZonedTime(day, IST);
}

/** IST midnight (00:00) of the calendar day an instant falls on, as UTC. */
export function startOfISTDay(date: Date): Date {
  return istTimeOnDay(date, 0);
}

/** The first instant of the next IST calendar day, as UTC. */
export function startOfNextISTDay(date: Date): Date {
  return istTimeOnDay(date, 0, 1);
}
