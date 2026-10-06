/**
 * Dates a member can commit from a button.
 *
 * The string is the same IST wall-clock form the web picker submits, so
 * `commitDeadline` parses it with no second interpreter.
 */
import { formatIST, fromISTInput } from '@/lib/utils/time';

const COMMIT_TIME = '18:00';

/** `days` ahead of `now`, at 6:00 PM IST. */
export function commitmentChoice(now: Date, days: number): string {
  const shifted = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return `${formatIST(shifted, 'yyyy-MM-dd')}T${COMMIT_TIME}`;
}

/**
 * A typed DD/MM or DD/MM/YYYY. Without a year, a date already past rolls to
 * next year. Returns the IST wall-clock string, or null when it is not a date.
 */
export function parseDayMonth(text: string, now: Date): string | null {
  const match = /^(\d{1,2})[/. -](\d{1,2})(?:[/. -](\d{4}))?$/.exec(text.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const explicitYear = match[3] ? Number(match[3]) : null;
  let year = explicitYear ?? Number(formatIST(now, 'yyyy'));

  const build = (y: number) =>
    `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${COMMIT_TIME}`;

  let value = build(year);
  if (!isRealDay(value, year, month, day)) return null;

  if (explicitYear === null && fromISTInput(value).getTime() <= now.getTime()) {
    year += 1;
    value = build(year);
    if (!isRealDay(value, year, month, day)) return null;
  }

  return value;
}

function isRealDay(value: string, year: number, month: number, day: number): boolean {
  try {
    const instant = fromISTInput(value);
    return (
      formatIST(instant, 'yyyy-MM-dd') ===
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    );
  } catch {
    return false;
  }
}

export function formatCommitment(value: string): string {
  return formatIST(fromISTInput(value), 'd MMM yyyy, h:mm a');
}
