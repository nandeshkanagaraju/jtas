import { describe, expect, it } from 'vitest';

import {
  addHours,
  addMinutes,
  formatIST,
  fromISTInput,
  fromISTWallClock,
  hoursBetween,
  istDateKey,
  istDayOfWeek,
  istMinutesOfDay,
  istTimeOnDay,
  minutesBetween,
  parseClockTime,
  parseInstant,
  startOfISTDay,
  startOfNextISTDay,
  toIST,
} from '@/lib/utils/time';

// IST is UTC+05:30 with no DST, so every expectation below is a fixed shift.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

describe('fromISTInput', () => {
  it('reads a naive datetime-local string as IST and returns UTC', () => {
    // 13 Sep 2026 16:30 IST === 13 Sep 2026 11:00 UTC
    expect(fromISTInput('2026-09-13T16:30').toISOString()).toBe('2026-09-13T11:00:00.000Z');
  });

  it('accepts a space separator and optional seconds', () => {
    expect(fromISTInput('2026-09-13 16:30:45').toISOString()).toBe('2026-09-13T11:00:45.000Z');
  });

  it('crosses the date boundary correctly before 05:30 IST', () => {
    // 01:00 IST on the 13th is still the 12th in UTC.
    expect(fromISTInput('2026-09-13T01:00').toISOString()).toBe('2026-09-12T19:30:00.000Z');
  });

  it('rejects an offset-qualified string rather than double-converting it', () => {
    expect(() => fromISTInput('2026-09-13T16:30:00Z')).toThrow(RangeError);
    expect(() => fromISTInput('2026-09-13T16:30:00+05:30')).toThrow(RangeError);
  });

  it('rejects garbage', () => {
    expect(() => fromISTInput('13/09/2026 4pm')).toThrow(RangeError);
    expect(() => fromISTInput('')).toThrow(RangeError);
  });

  it('round-trips through formatIST', () => {
    const utc = fromISTInput('2026-09-13T16:30');
    expect(formatIST(utc, 'yyyy-MM-dd HH:mm')).toBe('2026-09-13 16:30');
  });
});

describe('parseInstant', () => {
  it('accepts a Z-suffixed instant', () => {
    expect(parseInstant('2026-09-13T11:00:00Z').toISOString()).toBe('2026-09-13T11:00:00.000Z');
  });

  it('accepts an explicit +05:30 offset and normalises to UTC', () => {
    expect(parseInstant('2026-09-13T16:30:00+05:30').toISOString()).toBe(
      '2026-09-13T11:00:00.000Z',
    );
  });

  it('rejects a naive string, which would be ambiguous', () => {
    expect(() => parseInstant('2026-09-13T16:30')).toThrow(RangeError);
  });

  it('rejects an unparseable date', () => {
    expect(() => parseInstant('not-a-date+05:30')).toThrow(RangeError);
  });
});

describe('formatIST', () => {
  it('renders the default display pattern in IST', () => {
    expect(formatIST(new Date('2026-09-13T11:00:00Z'))).toBe('13 Sep 2026, 04:30 PM');
  });

  it('renders midnight IST as the following calendar day where appropriate', () => {
    // 18:45 UTC on the 12th is 00:15 IST on the 13th.
    expect(formatIST(new Date('2026-09-12T18:45:00Z'))).toBe('13 Sep 2026, 12:15 AM');
  });
});

describe('toIST / fromISTWallClock', () => {
  it('shifts local fields by the IST offset', () => {
    const utc = new Date('2026-09-13T11:00:00Z');
    expect(toIST(utc).getTime() - utc.getTime()).toBe(IST_OFFSET_MS);
  });

  it('is its own inverse', () => {
    const utc = new Date('2026-09-13T11:00:00Z');
    expect(fromISTWallClock(toIST(utc)).toISOString()).toBe(utc.toISOString());
  });
});

describe('istDateKey', () => {
  it('uses the IST calendar day, not the UTC one', () => {
    // 20:00 UTC on the 12th is already 01:30 IST on the 13th.
    expect(istDateKey(new Date('2026-09-12T20:00:00Z'))).toBe('2026-09-13');
    expect(istDateKey(new Date('2026-09-12T18:00:00Z'))).toBe('2026-09-12');
  });
});

describe('istDayOfWeek', () => {
  it('returns 0 for Sunday in IST', () => {
    // 13 Sep 2026 is a Sunday.
    expect(istDayOfWeek(new Date('2026-09-13T06:00:00Z'))).toBe(0);
  });

  it('rolls over at IST midnight, not UTC midnight', () => {
    // 12 Sep 2026 is a Saturday (6); 20:00 UTC is Sunday 01:30 IST.
    expect(istDayOfWeek(new Date('2026-09-12T14:00:00Z'))).toBe(6);
    expect(istDayOfWeek(new Date('2026-09-12T20:00:00Z'))).toBe(0);
  });
});

describe('istMinutesOfDay', () => {
  it('counts minutes since IST midnight', () => {
    expect(istMinutesOfDay(new Date('2026-09-13T03:30:00Z'))).toBe(9 * 60); // 09:00 IST
    expect(istMinutesOfDay(new Date('2026-09-13T12:30:00Z'))).toBe(18 * 60); // 18:00 IST
  });

  it('returns 0 at exactly IST midnight', () => {
    expect(istMinutesOfDay(new Date('2026-09-12T18:30:00Z'))).toBe(0);
  });
});

describe('hoursBetween / minutesBetween', () => {
  const a = new Date('2026-09-13T10:00:00Z');
  const b = new Date('2026-09-13T16:30:00Z');

  it('is positive when the second argument is later', () => {
    expect(hoursBetween(a, b)).toBe(6.5);
    expect(minutesBetween(a, b)).toBe(390);
  });

  it('is negative when the second argument is earlier', () => {
    expect(hoursBetween(b, a)).toBe(-6.5);
  });

  it('is zero for the same instant', () => {
    expect(hoursBetween(a, new Date(a))).toBe(0);
  });
});

describe('addMinutes / addHours', () => {
  it('shifts forwards and backwards without mutating the input', () => {
    const base = new Date('2026-09-13T10:00:00Z');
    expect(addMinutes(base, 90).toISOString()).toBe('2026-09-13T11:30:00.000Z');
    expect(addHours(base, -6).toISOString()).toBe('2026-09-13T04:00:00.000Z');
    expect(base.toISOString()).toBe('2026-09-13T10:00:00.000Z');
  });
});

describe('parseClockTime', () => {
  it('parses the seeded working-hour settings', () => {
    expect(parseClockTime('09:00')).toBe(540);
    expect(parseClockTime('18:00')).toBe(1080);
  });

  it('accepts a single-digit hour', () => {
    expect(parseClockTime('9:05')).toBe(545);
  });

  it('rejects out-of-range and malformed values', () => {
    expect(() => parseClockTime('24:00')).toThrow(RangeError);
    expect(() => parseClockTime('09:60')).toThrow(RangeError);
    expect(() => parseClockTime('9am')).toThrow(RangeError);
  });
});

describe('istTimeOnDay', () => {
  it('builds 09:00 IST on the reference day as UTC', () => {
    const reference = new Date('2026-09-13T11:00:00Z'); // 16:30 IST, 13 Sep
    expect(istTimeOnDay(reference, 9 * 60).toISOString()).toBe('2026-09-13T03:30:00.000Z');
  });

  it('honours a day offset', () => {
    const reference = new Date('2026-09-13T11:00:00Z');
    expect(istTimeOnDay(reference, 9 * 60, 1).toISOString()).toBe('2026-09-14T03:30:00.000Z');
  });

  it('anchors to the IST day even when the UTC day differs', () => {
    // 20:00 UTC 12 Sep is 01:30 IST 13 Sep — 09:00 IST "today" is the 13th.
    const reference = new Date('2026-09-12T20:00:00Z');
    expect(istTimeOnDay(reference, 9 * 60).toISOString()).toBe('2026-09-13T03:30:00.000Z');
  });

  it('rolls a day offset across a month boundary', () => {
    const reference = new Date('2026-09-30T11:00:00Z');
    expect(istTimeOnDay(reference, 9 * 60, 1).toISOString()).toBe('2026-10-01T03:30:00.000Z');
  });
});

describe('startOfISTDay / startOfNextISTDay', () => {
  it('returns IST midnight as 18:30 UTC the previous day', () => {
    expect(startOfISTDay(new Date('2026-09-13T11:00:00Z')).toISOString()).toBe(
      '2026-09-12T18:30:00.000Z',
    );
  });

  it('advances exactly 24 hours', () => {
    const reference = new Date('2026-09-13T11:00:00Z');
    expect(startOfNextISTDay(reference).getTime() - startOfISTDay(reference).getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
