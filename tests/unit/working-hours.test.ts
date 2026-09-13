import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WORKING_HOURS,
  isSuppressible,
  isWithinWorkingHours,
  isWorkingDay,
  nextWorkingSlot,
  toWorkingHoursConfig,
  type WorkingHoursConfig,
} from '@/lib/notifications/working-hours';
import { formatIST, fromISTInput } from '@/lib/utils/time';

/** The seeded configuration: 09:00–18:00 IST, Monday to Saturday. */
const CONFIG: WorkingHoursConfig = DEFAULT_WORKING_HOURS;

/** Renders a result as an IST wall-clock string, which is how the cases read. */
const ist = (date: Date) => formatIST(date, "yyyy-MM-dd'T'HH:mm");

/**
 * September 2026 calendar used below:
 *   Sun 13 · Mon 14 · Tue 15 · Wed 16 · Thu 17 · Fri 18 · Sat 19 · Sun 20
 */
describe('isWorkingDay', () => {
  it('is false on Sunday and true on the other six days', () => {
    expect(isWorkingDay(fromISTInput('2026-09-13T10:00'), CONFIG)).toBe(false); // Sun
    expect(isWorkingDay(fromISTInput('2026-09-14T10:00'), CONFIG)).toBe(true); // Mon
    expect(isWorkingDay(fromISTInput('2026-09-19T10:00'), CONFIG)).toBe(true); // Sat
  });

  it('uses the IST day, not the UTC one', () => {
    // 20:00 UTC on Saturday the 12th is already 01:30 IST on Sunday the 13th.
    expect(isWorkingDay(new Date('2026-09-12T20:00:00Z'), CONFIG)).toBe(false);
    // …while 14:00 UTC is still Saturday evening in IST.
    expect(isWorkingDay(new Date('2026-09-12T14:00:00Z'), CONFIG)).toBe(true);
  });

  it('is false on a holiday', () => {
    const withHoliday = { ...CONFIG, holidays: new Set(['2026-09-15']) };
    expect(isWorkingDay(fromISTInput('2026-09-15T10:00'), withHoliday)).toBe(false);
  });
});

describe('isWithinWorkingHours', () => {
  it('includes the opening minute and excludes the closing one', () => {
    expect(isWithinWorkingHours(fromISTInput('2026-09-14T09:00'), CONFIG)).toBe(true);
    expect(isWithinWorkingHours(fromISTInput('2026-09-14T17:59'), CONFIG)).toBe(true);
    // 18:00 is when the day ends, so it is already outside.
    expect(isWithinWorkingHours(fromISTInput('2026-09-14T18:00'), CONFIG)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nextWorkingSlot — the matrix the build spec asks for by name
// ---------------------------------------------------------------------------

describe('nextWorkingSlot', () => {
  it('leaves an instant inside working hours untouched', () => {
    const inside = fromISTInput('2026-09-14T11:00');
    expect(nextWorkingSlot(inside, CONFIG)).toEqual(inside);
  });

  it('moves an after-hours instant to the next morning', () => {
    // Monday 21:00 -> Tuesday 09:00.
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-14T21:00'), CONFIG))).toBe('2026-09-15T09:00');
  });

  it('moves a before-hours instant to the same morning', () => {
    // Tuesday 06:00 -> Tuesday 09:00, not Wednesday.
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-15T06:00'), CONFIG))).toBe('2026-09-15T09:00');
  });

  it('moves a Sunday to Monday morning', () => {
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-13T10:00'), CONFIG))).toBe('2026-09-14T09:00');
  });

  it('skips a holiday', () => {
    const config = { ...CONFIG, holidays: new Set(['2026-09-15']) };
    // Tuesday the 15th is a holiday, so Monday evening lands on Wednesday.
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-14T20:00'), config))).toBe('2026-09-16T09:00');
  });

  it('skips a holiday that is followed by a Sunday', () => {
    // Saturday the 19th is a holiday and Sunday the 20th is the weekly off,
    // so Friday evening lands on Monday the 21st.
    const config = { ...CONFIG, holidays: new Set(['2026-09-19']) };
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-18T22:00'), config))).toBe('2026-09-21T09:00');
  });

  it('skips a run of consecutive holidays', () => {
    const config = {
      ...CONFIG,
      holidays: new Set(['2026-09-15', '2026-09-16', '2026-09-17']),
    };
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-14T20:00'), config))).toBe('2026-09-18T09:00');
  });

  it('handles the 23:59 edge — the same night, not the same morning', () => {
    // Monday 23:59 is after hours, so it waits for Tuesday.
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-14T23:59'), CONFIG))).toBe('2026-09-15T09:00');
  });

  it('handles the 00:01 edge — later the same day', () => {
    // Tuesday 00:01 is before hours on a working day, so it waits only nine hours.
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-15T00:01'), CONFIG))).toBe('2026-09-15T09:00');
  });

  it('handles 00:01 on a Sunday — Monday, not Sunday', () => {
    expect(ist(nextWorkingSlot(fromISTInput('2026-09-13T00:01'), CONFIG))).toBe('2026-09-14T09:00');
  });

  it('never returns an instant in the past', () => {
    for (const at of [
      '2026-09-13T00:01',
      '2026-09-14T06:00',
      '2026-09-14T11:00',
      '2026-09-14T23:59',
      '2026-09-19T18:30',
    ]) {
      const input = fromISTInput(at);
      expect(nextWorkingSlot(input, CONFIG).getTime(), at).toBeGreaterThanOrEqual(input.getTime());
    }
  });

  it('always lands inside working hours', () => {
    for (const at of ['2026-09-13T02:00', '2026-09-14T20:00', '2026-09-18T22:00']) {
      expect(isWithinWorkingHours(nextWorkingSlot(fromISTInput(at), CONFIG), CONFIG), at).toBe(
        true,
      );
    }
  });

  it('gives up safely rather than looping on an impossible calendar', () => {
    // No working days at all: the mail goes out at an awkward hour rather than
    // never going out.
    const impossible = { ...CONFIG, workingDays: [] as number[] };
    const input = fromISTInput('2026-09-14T21:00');
    // `toWorkingHoursConfig` would have repaired this; a hand-built one must
    // still terminate.
    expect(() => nextWorkingSlot(input, impossible)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Configuration parsing
// ---------------------------------------------------------------------------

describe('toWorkingHoursConfig', () => {
  it('reads the seeded settings', () => {
    const config = toWorkingHoursConfig({
      start: '09:00',
      end: '18:00',
      workingDays: [1, 2, 3, 4, 5, 6],
      holidays: ['2026-09-15'],
    });

    expect(config.startMinutes).toBe(540);
    expect(config.endMinutes).toBe(1080);
    expect(config.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(config.holidays.has('2026-09-15')).toBe(true);
  });

  it('falls back to the defaults on a malformed clock value', () => {
    // A bad setting must not take the scheduler down.
    const config = toWorkingHoursConfig({ start: 'nine o clock', end: '18:00' });
    expect(config.startMinutes).toBe(DEFAULT_WORKING_HOURS.startMinutes);
    expect(config.endMinutes).toBe(DEFAULT_WORKING_HOURS.endMinutes);
  });

  it('rejects a start at or after the end, which would make every day unworkable', () => {
    const config = toWorkingHoursConfig({ start: '18:00', end: '09:00' });
    expect(config.startMinutes).toBe(540);
    expect(config.endMinutes).toBe(1080);
  });

  it('falls back when working days are missing or nonsense', () => {
    expect(toWorkingHoursConfig({}).workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(toWorkingHoursConfig({ workingDays: 'monday' }).workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(toWorkingHoursConfig({ workingDays: [9, -1] }).workingDays).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('accepts a genuine Sunday-only week', () => {
    expect(toWorkingHoursConfig({ workingDays: [0] }).workingDays).toEqual([0]);
  });
});

describe('isSuppressible', () => {
  it('shifts reminders, assignments and the digest', () => {
    expect(isSuppressible('DEADLINE_REMINDER')).toBe(true);
    expect(isSuppressible('SUBTASK_ASSIGNED')).toBe(true);
    expect(isSuppressible('DAILY_DIGEST_MD')).toBe(true);
  });

  it('never shifts an overdue mail or a problem alert', () => {
    // SDD 5.3: these are urgent by definition. An overdue task at 2 AM is
    // still overdue, and a blocker that waits until 9 AM costs a shift.
    expect(isSuppressible('OVERDUE_MEMBER')).toBe(false);
    expect(isSuppressible('OVERDUE_MD')).toBe(false);
    expect(isSuppressible('PROBLEM_RAISED')).toBe(false);
  });
});
