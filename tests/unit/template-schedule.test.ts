import { describe, expect, it } from 'vitest';

import { scheduleFromTemplate } from '@/lib/domain/template-schedule';
import { fromISTInput } from '@/lib/utils/time';

const JOB_DEADLINE = fromISTInput('2027-06-30T18:00');
const NOW = new Date('2027-01-01T00:00:00Z');

const ITEMS = [
  { order: 1, offsetHoursBeforeDue: 336, dependsOnItemOrder: null }, // 14 days
  { order: 2, offsetHoursBeforeDue: 288, dependsOnItemOrder: 1 }, // 12 days
  { order: 7, offsetHoursBeforeDue: 0, dependsOnItemOrder: 6 }, // on the deadline
];

describe('scheduleFromTemplate', () => {
  it('subtracts each offset from the job deadline, in IST', () => {
    const scheduled = scheduleFromTemplate(ITEMS, JOB_DEADLINE, NOW);

    // 30 June 18:00 IST minus 14 days is 16 June 18:00 IST.
    expect(scheduled[0].deadline).toBe('2027-06-16T18:00');
    expect(scheduled[1].deadline).toBe('2027-06-18T18:00');
    // A zero offset lands exactly on the job deadline.
    expect(scheduled[2].deadline).toBe('2027-06-30T18:00');
  });

  it('emits naive wall-clock strings the server will accept', () => {
    for (const { deadline } of scheduleFromTemplate(ITEMS, JOB_DEADLINE, NOW)) {
      expect(deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(() => fromISTInput(deadline)).not.toThrow();
    }
  });

  it('flags a deadline that would fall in the past rather than clamping it', () => {
    // A job due in three days cannot carry a 14-day-lead template.
    const soon = fromISTInput('2027-01-04T18:00');
    const scheduled = scheduleFromTemplate(ITEMS, soon, NOW);

    expect(scheduled[0].inThePast).toBe(true);
    expect(scheduled[2].inThePast).toBe(false);
  });

  it('preserves the original item alongside the computed deadline', () => {
    const scheduled = scheduleFromTemplate(ITEMS, JOB_DEADLINE, NOW);
    expect(scheduled.map((s) => s.item.order)).toEqual([1, 2, 7]);
    expect(scheduled[1].item.dependsOnItemOrder).toBe(1);
  });

  it('handles an empty template', () => {
    expect(scheduleFromTemplate([], JOB_DEADLINE, NOW)).toEqual([]);
  });
});
