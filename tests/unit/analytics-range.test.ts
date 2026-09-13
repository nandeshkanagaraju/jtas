import { describe, expect, it } from 'vitest';

import {
  currentMonth,
  dayKeysIn,
  lastDays,
  parseRange,
  range,
} from '@/lib/services/analytics/range';
import { formatIST, fromISTInput } from '@/lib/utils/time';

describe('range', () => {
  it('starts at IST midnight and ends one tick past the last day', () => {
    const september = range('2026-09-01', '2026-09-30');

    expect(formatIST(september.from)).toBe(formatIST(fromISTInput('2026-09-01T00:00')));
    // Exclusive: 1 October 00:00 IST, so 30 September 11:59 PM is inside.
    expect(formatIST(september.until)).toBe(formatIST(fromISTInput('2026-10-01T00:00')));
  });

  it('covers the last evening of the month, which UTC boundaries would drop', () => {
    const september = range('2026-09-01', '2026-09-30');
    const lateEvening = fromISTInput('2026-09-30T23:30');

    // 11:30 PM IST on the 30th is 18:00 UTC on the 30th. A naive UTC month end
    // would still hold it, but 1 AM IST on the 1st is 19:30 UTC on the *31st of
    // August* — the case below is the one that actually breaks.
    expect(lateEvening >= september.from && lateEvening < september.until).toBe(true);
  });

  it('excludes the hours before IST midnight that belong to the previous month', () => {
    const september = range('2026-09-01', '2026-09-30');
    const justBefore = fromISTInput('2026-08-31T23:30');

    expect(justBefore < september.from).toBe(true);
  });
});

describe('currentMonth', () => {
  it('spans the whole IST month the instant falls in', () => {
    const month = currentMonth(fromISTInput('2026-09-14T03:00'));

    expect(month.fromKey).toBe('2026-09-01');
    expect(month.toKey).toBe('2026-09-30');
  });

  it('gets February right in a leap year and a common one', () => {
    expect(currentMonth(fromISTInput('2028-02-10T12:00')).toKey).toBe('2028-02-29');
    expect(currentMonth(fromISTInput('2026-02-10T12:00')).toKey).toBe('2026-02-28');
  });

  it('uses the IST month, not the UTC one, late on the last evening', () => {
    // 1 AM IST on 1 October is 19:30 UTC on 30 September. Reading the UTC month
    // would put the MD's morning dashboard back in September.
    const month = currentMonth(fromISTInput('2026-10-01T01:00'));

    expect(month.fromKey).toBe('2026-10-01');
    expect(month.toKey).toBe('2026-10-31');
  });
});

describe('lastDays', () => {
  it('is inclusive of today and counts back', () => {
    const window = lastDays(30, fromISTInput('2026-09-14T12:00'));

    expect(window.toKey).toBe('2026-09-14');
    expect(window.fromKey).toBe('2026-08-16');
    expect(dayKeysIn(window)).toHaveLength(30);
  });

  it('crosses a month boundary without losing a day', () => {
    const window = lastDays(7, fromISTInput('2026-03-03T12:00'));

    expect(dayKeysIn(window)).toEqual([
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
    ]);
  });
});

describe('dayKeysIn', () => {
  it('lists every IST day in order', () => {
    expect(dayKeysIn(range('2026-09-01', '2026-09-03'))).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
  });

  it('returns a single day for a one-day range', () => {
    expect(dayKeysIn(range('2026-09-05', '2026-09-05'))).toEqual(['2026-09-05']);
  });
});

describe('parseRange', () => {
  const NOW = fromISTInput('2026-09-14T12:00');

  it('uses the given range when both dates parse', () => {
    const parsed = parseRange({ from: '2026-07-01', to: '2026-07-31' }, NOW);

    expect(parsed.fromKey).toBe('2026-07-01');
    expect(parsed.toKey).toBe('2026-07-31');
  });

  it.each([
    ['missing both', {}],
    ['missing one', { from: '2026-07-01' }],
    ['not a date', { from: 'last tuesday', to: 'today' }],
    ['wrong shape', { from: '01-07-2026', to: '31-07-2026' }],
    ['impossible day', { from: '2026-02-31', to: '2026-03-01' }],
    ['inverted', { from: '2026-09-30', to: '2026-09-01' }],
  ])('falls back to the current month when the range is %s', (_label, params) => {
    /*
     * A dashboard that answers 400 because a bookmarked URL has a stale date is
     * worse than one that quietly shows this month.
     */
    const parsed = parseRange(params, NOW);

    expect(parsed.fromKey).toBe('2026-09-01');
    expect(parsed.toKey).toBe('2026-09-30');
  });

  it('accepts a single day', () => {
    const parsed = parseRange({ from: '2026-09-10', to: '2026-09-10' }, NOW);

    expect(parsed.fromKey).toBe('2026-09-10');
    expect(dayKeysIn(parsed)).toHaveLength(1);
  });

  it('ignores surrounding whitespace', () => {
    const parsed = parseRange({ from: ' 2026-07-01 ', to: ' 2026-07-31 ' }, NOW);

    expect(parsed.fromKey).toBe('2026-07-01');
  });
});
