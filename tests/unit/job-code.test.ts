import { describe, expect, it } from 'vitest';

import { formatJobCode, jobCodeYear, parseJobCode } from '@/lib/domain/job-code';

describe('formatJobCode', () => {
  it('produces the SDD 4.1 format', () => {
    expect(formatJobCode(2026, 1)).toBe('JGE-2026-0001');
    expect(formatJobCode(2026, 42)).toBe('JGE-2026-0042');
    expect(formatJobCode(2026, 9999)).toBe('JGE-2026-9999');
  });

  it('grows past four digits rather than wrapping', () => {
    // Wrapping would collide with January's first order.
    expect(formatJobCode(2026, 10_000)).toBe('JGE-2026-10000');
  });

  it('rejects a sequence that is not a positive integer', () => {
    expect(() => formatJobCode(2026, 0)).toThrow(RangeError);
    expect(() => formatJobCode(2026, -1)).toThrow(RangeError);
    expect(() => formatJobCode(2026, 1.5)).toThrow(RangeError);
  });

  it('rejects an implausible year', () => {
    expect(() => formatJobCode(26, 1)).toThrow(RangeError);
    expect(() => formatJobCode(20_260, 1)).toThrow(RangeError);
  });
});

describe('parseJobCode', () => {
  it('round-trips a formatted code', () => {
    expect(parseJobCode(formatJobCode(2026, 42))).toEqual({ year: 2026, sequence: 42 });
  });

  it('accepts lower case and surrounding whitespace', () => {
    expect(parseJobCode('  jge-2026-0042 ')).toEqual({ year: 2026, sequence: 42 });
  });

  it('returns null for anything else', () => {
    for (const bad of ['', 'JGE-2026', 'ABC-2026-0001', 'JGE-26-0001', 'JGE-2026-1']) {
      expect(parseJobCode(bad), bad).toBeNull();
    }
  });
});

describe('jobCodeYear', () => {
  it('uses the IST calendar year', () => {
    expect(jobCodeYear(new Date('2026-06-15T12:00:00Z'))).toBe(2026);
  });

  it('numbers a New Year job in the IST year, not the UTC one', () => {
    // 02:00 IST on 1 Jan 2027 is 20:30 UTC on 31 Dec 2026. Numbering it 2026
    // would put it in the wrong year's sequence and the wrong year's reports.
    expect(jobCodeYear(new Date('2026-12-31T20:30:00Z'))).toBe(2027);
    // And 18:00 UTC on 31 Dec is still 23:30 IST on the 31st.
    expect(jobCodeYear(new Date('2026-12-31T18:00:00Z'))).toBe(2026);
  });
});
