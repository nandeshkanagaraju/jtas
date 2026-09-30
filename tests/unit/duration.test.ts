import { describe, expect, it } from 'vitest';

import { formatDuration, formatElapsed } from '@/lib/utils/duration';

describe('formatDuration', () => {
  it.each([
    [0, '0 minutes'],
    [1, '1 minute'],
    [59, '59 minutes'],
    [60, '1 hour'],
    [61, '1 hour 1 minute'],
    [90, '1 hour 30 minutes'],
    [1439, '23 hours 59 minutes'],
    [1440, '24 hours'],
    [2880, '2 days'],
  ])('%i minutes → %s', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });

  it('does not render a non-zero span as zero', () => {
    expect(formatDuration(0.4)).toBe('1 minute');
  });
});

describe('formatElapsed', () => {
  it.each([
    [59, '59 minutes'],
    [60, '1 hour'],
    [200, '3 hours 20 minutes'],
    [359, '5 hours 59 minutes'],
    [360, '6 hours'],
    [2879, '47 hours'],
    [2880, '2 days'],
    [20159, '13 days'],
    [20160, '2 weeks'],
    [17 * 24 * 60, '2 weeks'],
    [80640, '2 months'],
  ])('%i minutes → %s', (minutes, expected) => {
    expect(formatElapsed(minutes)).toBe(expected);
  });

  it('never uses more than two units, and only one past six hours', () => {
    let offender: string | null = null;

    for (let minutes = 0; minutes <= 90_000; minutes++) {
      const phrase = formatElapsed(minutes);
      const units = phrase.match(/\d+ \w+/g) ?? [];

      if (units.length > 2 || (minutes >= 360 && units.length > 1)) {
        offender = `${minutes} → ${phrase}`;
        break;
      }
    }

    expect(offender).toBeNull();
  });
});
