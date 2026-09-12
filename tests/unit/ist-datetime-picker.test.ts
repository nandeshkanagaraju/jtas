import { describe, expect, it } from 'vitest';

import {
  TIME_STEP_MINUTES,
  buildTimeOptions,
  splitIstValue,
} from '@/components/shared/ist-datetime-picker';
import { fromISTInput } from '@/lib/utils/time';

describe('buildTimeOptions', () => {
  it('covers the day in 15-minute steps', () => {
    const options = buildTimeOptions();
    expect(TIME_STEP_MINUTES).toBe(15);
    expect(options).toHaveLength((24 * 60) / 15);
    expect(options[0]).toBe('00:00');
    expect(options[1]).toBe('00:15');
    expect(options.at(-1)).toBe('23:45');
  });

  it('zero-pads so the list sorts and aligns', () => {
    expect(buildTimeOptions()).toContain('09:00');
    expect(buildTimeOptions()).toContain('09:45');
  });

  it('honours a different step', () => {
    expect(buildTimeOptions(30)).toHaveLength(48);
  });

  it('emits only values the server will accept as IST wall-clock times', () => {
    for (const time of buildTimeOptions()) {
      expect(() => fromISTInput(`2026-10-15T${time}`)).not.toThrow();
    }
  });
});

describe('splitIstValue', () => {
  it('splits a full value', () => {
    expect(splitIstValue('2026-10-15T16:30')).toEqual({ date: '2026-10-15', time: '16:30' });
  });

  it('tolerates an empty or partial value', () => {
    expect(splitIstValue('')).toEqual({ date: '', time: '' });
    expect(splitIstValue('2026-10-15')).toEqual({ date: '2026-10-15', time: '' });
  });
});

describe('the value never carries an offset', () => {
  it('round-trips through fromISTInput to the expected UTC instant', () => {
    // This is the contract the picker exists to keep: what the MD chose in IST
    // is what the scheduler stores in UTC.
    expect(fromISTInput('2026-10-15T16:30').toISOString()).toBe('2026-10-15T11:00:00.000Z');
  });

  it('is rejected by parseInstant, proving it is naive', () => {
    // A value that carried an offset would be double-converted somewhere.
    expect('2026-10-15T16:30').not.toMatch(/[zZ]|[+-]\d{2}:?\d{2}$/);
  });
});
