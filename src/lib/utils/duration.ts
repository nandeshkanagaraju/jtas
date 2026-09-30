/**
 * One way to say how long something is.
 *
 * Durations are stored in minutes. Rendering them as integer hours turns
 * 15 minutes into "0 hours", in the subject line and the body and the
 * dashboard alike. Every one of those calls this.
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

/** "15 minutes", "1 hour", "1 hour 30 minutes", "2 days". */
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
