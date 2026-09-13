/**
 * The holiday calendar (build spec M9.3).
 *
 * A holiday is an IST calendar day, stored as midnight IST in UTC. The column
 * is unique, so adding the same day twice is idempotent rather than an error —
 * importing the annual list twice should leave one Diwali, not two.
 *
 * Adding a holiday does not rewrite notifications already scheduled. It changes
 * where `nextWorkingSlot` lands from the next sweep onward, which is what moves
 * a reminder off the day; a reminder that has already been sent has already
 * been sent.
 */
import { prisma } from '@/lib/db/prisma';
import { conflict, notFound, validationError } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { fromISTInput, istDateKey } from '@/lib/utils/time';

export interface HolidayRow {
  id: string;
  /** IST calendar day, `YYYY-MM-DD`. */
  date: string;
  name: string;
}

export interface HolidayActor {
  id: string;
}

export interface HolidayContext {
  ipAddress: string | null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight IST on the day `key` names. */
function startOfDay(key: string): Date {
  return fromISTInput(`${key}T00:00`);
}

/** Rejects 2026-02-31, which `fromISTInput` would roll into March. */
function assertRealDay(key: string): void {
  if (!DAY_KEY.test(key)) {
    throw validationError('A holiday needs a date.', {
      fields: { date: ['Use the form 2026-01-26.'] },
    });
  }

  const [year, month, day] = key.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw validationError(`${key} is not a real date.`, {
      fields: { date: ['Check the month and day.'] },
    });
  }
}

/** Holidays in a range, or all of them. Oldest first. */
export async function listHolidays(
  options: { from?: string; to?: string } = {},
): Promise<HolidayRow[]> {
  const where =
    options.from && options.to
      ? {
          date: {
            gte: startOfDay(options.from),
            // Exclusive end at the next midnight, so the last day is included.
            lt: new Date(startOfDay(options.to).getTime() + 24 * 3_600_000),
          },
        }
      : {};

  const rows = await prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });

  return rows.map((row) => ({ id: row.id, date: istDateKey(row.date), name: row.name }));
}

export interface AddHolidayInput {
  date: string;
  name: string;
}

/**
 * Adds one or many holidays.
 *
 * Returns what was actually added and what was already there, rather than
 * failing the batch on the first duplicate: a CSV of next year's list will
 * overlap this year's by the fixed dates, and refusing the whole import over
 * Republic Day helps nobody.
 */
export async function addHolidays(
  input: AddHolidayInput[],
  actor: HolidayActor,
  ctx: HolidayContext,
): Promise<{ added: HolidayRow[]; alreadyPresent: HolidayRow[] }> {
  if (input.length === 0) {
    throw validationError('Nothing to add.', { reason: 'EMPTY' });
  }

  if (input.length > 200) {
    throw validationError('That is more than a year of holidays.', {
      fields: { holidays: ['At most 200 at a time.'] },
    });
  }

  const cleaned = input.map((entry) => {
    const date = entry.date?.trim() ?? '';
    const name = entry.name?.trim() ?? '';

    assertRealDay(date);

    if (name.length < 2 || name.length > 80) {
      throw validationError(`${date} needs a name.`, {
        fields: { name: ['Between 2 and 80 characters — "Diwali", "Factory shutdown".'] },
      });
    }

    return { date, name };
  });

  // Last one wins within a batch, so a CSV that lists a day twice is not a
  // unique-constraint failure.
  const byDate = new Map(cleaned.map((entry) => [entry.date, entry]));

  const added: HolidayRow[] = [];
  const alreadyPresent: HolidayRow[] = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of byDate.values()) {
      const at = startOfDay(entry.date);
      const existing = await tx.holiday.findUnique({ where: { date: at } });

      if (existing) {
        alreadyPresent.push({ id: existing.id, date: entry.date, name: existing.name });
        continue;
      }

      const row = await tx.holiday.create({ data: { date: at, name: entry.name } });
      added.push({ id: row.id, date: entry.date, name: row.name });
    }

    if (added.length === 0) return;

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'HOLIDAY_ADDED',
      entityType: 'HOLIDAY',
      // One row per import, keyed by what was added: an annual list is one act.
      entityId: added.map((row) => row.date).join(','),
      after: { holidays: added.map((row) => ({ date: row.date, name: row.name })) },
      ipAddress: ctx.ipAddress,
    });
  });

  return { added, alreadyPresent };
}

/** Removes one holiday. */
export async function removeHoliday(
  id: string,
  actor: HolidayActor,
  ctx: HolidayContext,
): Promise<HolidayRow> {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw notFound('Holiday');

  const key = istDateKey(existing.date);

  if (existing.date.getTime() < Date.now() - 365 * 24 * 3_600_000) {
    /*
     * A holiday more than a year past is history that the on-time figures were
     * computed against. Deleting it would silently change what "working day"
     * meant last year.
     */
    throw conflict('That holiday is more than a year old and is part of the record.', {
      reason: 'HOLIDAY_HISTORIC',
      date: key,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id } });

    await writeAudit(tx, {
      actorId: actor.id,
      action: 'HOLIDAY_REMOVED',
      entityType: 'HOLIDAY',
      entityId: key,
      before: { date: key, name: existing.name },
      ipAddress: ctx.ipAddress,
    });
  });

  return { id, date: key, name: existing.name };
}

/**
 * Parses the annual list as CSV.
 *
 * Two columns, `date,name`, with or without a header. Blank lines and anything
 * after a `#` are ignored so a list can carry comments.
 */
export function parseHolidayCsv(csv: string): AddHolidayInput[] {
  const rows: AddHolidayInput[] = [];

  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const [date, ...rest] = line.split(',');
    const key = date?.trim() ?? '';

    // Skips a header row without needing to be told there is one.
    if (!DAY_KEY.test(key)) continue;

    rows.push({ date: key, name: rest.join(',').trim().replace(/^"|"$/g, '') });
  }

  if (rows.length === 0) {
    throw validationError('No holidays found in that file.', {
      fields: { csv: ['Each line should read 2026-01-26,Republic Day.'] },
    });
  }

  return rows;
}
