/**
 * Date ranges for the dashboard and the reports.
 *
 * A range that arrives as "2026-09-01" means the whole of that day in
 * Coimbatore, not a UTC midnight — so the boundaries are built through
 * `fromISTInput` rather than `new Date(string)`, which would silently shift
 * every figure by five and a half hours and make a month's last evening belong
 * to the next month.
 */
import { fromISTInput, istDateKey, toIST } from '@/lib/utils/time';

export interface DateRange {
  /** Inclusive start, UTC. */
  from: Date;
  /** Exclusive end, UTC — one tick past the last moment of `to`. */
  until: Date;
  /** The IST calendar days the caller asked for, for labelling. */
  fromKey: string;
  toKey: string;
}

/** The IST calendar day `date` falls on, as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
  return istDateKey(date);
}

/** Start of the IST day `key` names. */
function startOfDay(key: string): Date {
  return fromISTInput(`${key}T00:00`);
}

/** One tick past the end of the IST day `key` names. */
function endOfDay(key: string): Date {
  const next = new Date(startOfDay(key).getTime() + 24 * 3_600_000);
  return next;
}

/** The current IST month, which is what the dashboard opens on. */
export function currentMonth(now: Date = new Date()): DateRange {
  const ist = toIST(now);
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, ist.getMonth() + 1, 0)).getUTCDate();

  return range(`${year}-${month}-01`, `${year}-${month}-${String(lastDay).padStart(2, '0')}`);
}

/** A range from two `YYYY-MM-DD` keys, inclusive of both days. */
export function range(fromKey: string, toKey: string): DateRange {
  return { from: startOfDay(fromKey), until: endOfDay(toKey), fromKey, toKey };
}

/** The `days` IST days ending today, inclusive — the trend window. */
export function lastDays(days: number, now: Date = new Date()): DateRange {
  const toKey = istDateKey(now);
  const fromKey = istDateKey(new Date(now.getTime() - (days - 1) * 24 * 3_600_000));
  return range(fromKey, toKey);
}

/** Every IST day key in the range, oldest first. */
export function dayKeysIn(dateRange: DateRange): string[] {
  const keys: string[] = [];

  for (
    let cursor = dateRange.from.getTime();
    cursor < dateRange.until.getTime();
    cursor += 24 * 3_600_000
  ) {
    keys.push(istDateKey(new Date(cursor)));
  }

  return keys;
}

/**
 * Parses `from`/`to` query parameters, falling back to the current month.
 *
 * An unparseable or inverted range falls back rather than throwing: a dashboard
 * that answers 400 because a bookmarked URL has a stale date is worse than one
 * that shows this month.
 */
export function parseRange(
  params: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): DateRange {
  const from = params.from?.trim();
  const to = params.to?.trim();

  if (!from || !to || !isDayKey(from) || !isDayKey(to)) return currentMonth(now);

  const parsed = range(from, to);
  if (parsed.until.getTime() <= parsed.from.getTime()) return currentMonth(now);

  return parsed;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isDayKey(value: string): boolean {
  if (!DAY_KEY.test(value)) return false;

  // Rejects 2026-02-31 and friends, which `fromISTInput` would roll forward.
  const [year, month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}
