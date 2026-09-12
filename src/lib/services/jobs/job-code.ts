/**
 * Job-code allocation — SDD section 4.1.
 *
 * The sequence must be gapless, per calendar year, and collision-free under
 * concurrency: two clerks pressing "create" at the same instant must not both
 * get `JGE-2026-0007`.
 *
 * The allocation is a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`
 * against the `JobCodeCounter` row for the year. That is one statement, and
 * PostgreSQL takes a row-level lock for its duration, so a concurrent caller
 * blocks until it commits and then reads the incremented value. It is
 * equivalent to the `SELECT … FOR UPDATE` the SDD suggests, with two advantages:
 * one round trip instead of two, and no window between the read and the write
 * in which the transaction could be interrupted.
 *
 * It must be called inside the same transaction as the job insert, so that a
 * failed insert rolls the number back rather than burning it.
 */
import type { Db } from '@/lib/db/prisma';
import { formatJobCode, jobCodeYear } from '@/lib/domain/job-code';

interface CounterRow {
  last: number;
}

/**
 * Reserves the next sequence number for `instant`'s IST calendar year and
 * returns the formatted code.
 *
 * @param db Must be a transaction client — see the note above.
 */
export async function allocateJobCode(db: Db, instant: Date = new Date()): Promise<string> {
  const year = jobCodeYear(instant);

  const rows = await db.$queryRaw<CounterRow[]>`
    INSERT INTO "JobCodeCounter" ("year", "last")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "JobCodeCounter"."last" + 1
    RETURNING "last"
  `;

  const last = rows[0]?.last;
  if (typeof last !== 'number') {
    throw new Error(`Job-code counter for ${year} returned no sequence.`);
  }

  return formatJobCode(year, last);
}
