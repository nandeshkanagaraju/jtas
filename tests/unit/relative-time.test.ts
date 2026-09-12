import { describe, expect, it } from 'vitest';

import { deadlineLabel } from '@/lib/utils/relative-time';

const NOW = new Date('2026-09-13T10:00:00Z');
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * 3_600_000);

describe('deadlineLabel', () => {
  it('counts minutes under an hour', () => {
    expect(deadlineLabel(at(0.5), NOW)).toMatchObject({ text: 'in 30 min', tone: 'urgent' });
  });

  it('counts hours up to two days', () => {
    expect(deadlineLabel(at(5), NOW).text).toBe('in 5 h');
    expect(deadlineLabel(at(47), NOW).text).toBe('in 47 h');
  });

  it('switches to days, then weeks, then months', () => {
    expect(deadlineLabel(at(72), NOW).text).toBe('in 3 days');
    expect(deadlineLabel(at(24 * 21), NOW).text).toBe('in 3 weeks');
    expect(deadlineLabel(at(24 * 90), NOW).text).toBe('in 3 months');
  });

  it('marks a passed deadline as late, not as a negative "in"', () => {
    const label = deadlineLabel(at(-30), NOW);
    expect(label.overdue).toBe(true);
    expect(label.tone).toBe('overdue');
    expect(label.text).toBe('30 h late');
    expect(label.text).not.toContain('-');
  });

  it('tones by urgency: urgent within a day, soon within three', () => {
    expect(deadlineLabel(at(23), NOW).tone).toBe('urgent');
    expect(deadlineLabel(at(25), NOW).tone).toBe('soon');
    expect(deadlineLabel(at(71), NOW).tone).toBe('soon');
    expect(deadlineLabel(at(100), NOW).tone).toBe('normal');
  });

  it('never reports "0 min"', () => {
    // A deadline one second away still reads as a minute, not as nothing.
    expect(deadlineLabel(new Date(NOW.getTime() + 1_000), NOW).text).toBe('in 1 min');
  });
});
