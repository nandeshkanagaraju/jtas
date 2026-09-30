/**
 * Two ways to say how long something is.
 *
 * `formatDuration` is for a length somebody set: a 15-minute reminder lead
 * must say 15 minutes. `formatElapsed` is for a span since or until an event.
 * Precision there decays, because the minutes on a 17-day-old problem are
 * noise.
 *
 * Both take minutes. Rendering a span as integer hours turns 15 minutes into
 * "0 hours".
 */

function unit(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Whole minutes for display.
 *
 * A span that is not zero but rounds to zero minutes — a few seconds — is
 * one minute. Zero stays zero.
 */
export function displayMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes === 0) return 0;

  const rounded = Math.round(Math.abs(minutes));
  return rounded === 0 ? 1 : rounded;
}

/** A length somebody chose. "15 minutes", "1 hour 30 minutes", "2 days 3 hours". */
export function formatDuration(minutes: number): string {
  const whole = displayMinutes(minutes);
  if (whole === 0) return '0 minutes';

  if (whole >= 48 * 60) {
    const days = Math.floor(whole / (24 * 60));
    const rest = whole % (24 * 60);
    const daysLabel = unit(days, 'day', 'days');
    return rest === 0 ? daysLabel : `${daysLabel} ${formatDuration(rest)}`;
  }

  const hours = Math.floor(whole / 60);
  const mins = whole % 60;

  if (hours === 0) return unit(mins, 'minute', 'minutes');
  if (mins === 0) return unit(hours, 'hour', 'hours');
  return `${unit(hours, 'hour', 'hours')} ${unit(mins, 'minute', 'minutes')}`;
}

const HOUR = 60;
const SIX_HOURS = 6 * HOUR;
const DAY = 24 * HOUR;
const TWO_DAYS = 48 * HOUR;
const WEEK = 7 * DAY;
const TWO_WEEKS = 14 * DAY;

/**
 * How long since or until something happened.
 *
 * Under an hour, minutes. Under six hours, hours and minutes. Then one unit,
 * coarser as the span grows: hours, days, weeks, and months of four weeks.
 * The count is floored, so 17 days is "2 weeks".
 */
export function formatElapsed(minutes: number): string {
  const whole = displayMinutes(minutes);
  if (whole === 0) return '0 minutes';

  if (whole < HOUR) return unit(whole, 'minute', 'minutes');

  if (whole < SIX_HOURS) {
    const hours = Math.floor(whole / HOUR);
    const mins = whole % HOUR;
    const hoursLabel = unit(hours, 'hour', 'hours');
    return mins === 0 ? hoursLabel : `${hoursLabel} ${unit(mins, 'minute', 'minutes')}`;
  }

  if (whole < TWO_DAYS) return unit(Math.floor(whole / HOUR), 'hour', 'hours');
  if (whole < TWO_WEEKS) return unit(Math.floor(whole / DAY), 'day', 'days');

  const weeks = Math.floor(whole / WEEK);
  if (weeks < 8) return unit(weeks, 'week', 'weeks');

  return unit(Math.floor(weeks / 4), 'month', 'months');
}
