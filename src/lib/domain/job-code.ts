/**
 * Job codes — SDD section 4.1: `JGE-{YYYY}-{NNNN}`, sequential per calendar year.
 *
 * The formatting is pure and lives here; the sequence allocation needs a
 * database and lives in `@/lib/services/jobs/job-code.ts`.
 */
import { formatIST } from '@/lib/utils/time';

export const JOB_CODE_PREFIX = 'JGE';

/** `JGE-2026-0001`. */
export const JOB_CODE_PATTERN = /^JGE-(\d{4})-(\d{4,})$/;

/**
 * Formats a sequence number into a job code.
 *
 * Padded to four digits, and deliberately *not* truncated beyond that: the
 * 10,000th job of a year gets `JGE-2026-10000` rather than wrapping to `0000`
 * and colliding with January's first order.
 */
export function formatJobCode(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new RangeError(`Job code year must be a four-digit year, got ${year}.`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Job code sequence must be a positive integer, got ${sequence}.`);
  }

  return `${JOB_CODE_PREFIX}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Splits a job code back into its parts, or `null` if it is not one. */
export function parseJobCode(code: string): { year: number; sequence: number } | null {
  const match = JOB_CODE_PATTERN.exec(code.trim().toUpperCase());
  if (!match) return null;

  return { year: Number(match[1]), sequence: Number(match[2]) };
}

/**
 * The calendar year a job created at `instant` belongs to — in **IST**, not UTC.
 *
 * This matters for about five and a half hours every New Year: a job created at
 * 02:00 IST on 1 January 2027 is 20:30 UTC on 31 December 2026, and numbering it
 * `JGE-2026-…` would put it in the wrong year's sequence and the wrong year's
 * reports (architecture rule 1).
 */
export function jobCodeYear(instant: Date): number {
  return Number(formatIST(instant, 'yyyy'));
}
