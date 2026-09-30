import { describe, expect, it } from 'vitest';

import { formatDuration } from '@/lib/utils/duration';

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
