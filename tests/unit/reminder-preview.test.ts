import { describe, expect, it } from 'vitest';

import { previewReminder } from '@/lib/domain/reminder-preview';
import { DEFAULT_WORKING_HOURS } from '@/lib/notifications/working-hours';
import { fromISTInput } from '@/lib/utils/time';

const HOURS = { ...DEFAULT_WORKING_HOURS };

const DUE_6PM = fromISTInput('2026-09-12T18:00');

describe('previewReminder', () => {
  it('subtracts the lead time and says so plainly', () => {
    const preview = previewReminder(DUE_6PM, 360, {
      suppressOutsideHours: false,
      workingHours: HOURS,
    });

    expect(preview.shifted).toBe(false);
    expect(preview.sentence).toBe('A task due 12 Sep 6:00 PM will remind at 12 Sep 12:00 PM.');
  });

  it('tracks a change in lead time', () => {
    const four = previewReminder(DUE_6PM, 240, {
      suppressOutsideHours: false,
      workingHours: HOURS,
    });

    // The whole point: an operator sees the result before saving.
    expect(four.sentence).toContain('remind at 12 Sep 2:00 PM');
  });

  it('shows the shift when the reminder would land outside working hours', () => {
    // 6 AM is before the 9 AM start, so the reminder waits.
    const preview = previewReminder(fromISTInput('2026-09-12T12:00'), 360, {
      suppressOutsideHours: true,
      workingHours: HOURS,
    });

    expect(preview.shifted).toBe(true);
    expect(preview.sentence).toContain('outside working hours');
    expect(preview.sentence).toContain('remind at 12 Sep 9:00 AM');
  });

  it('does not shift when suppression is off', () => {
    const preview = previewReminder(fromISTInput('2026-09-12T12:00'), 360, {
      suppressOutsideHours: false,
      workingHours: HOURS,
    });

    expect(preview.shifted).toBe(false);
    expect(preview.at.toISOString()).toBe(preview.rawAt.toISOString());
  });

  it('moves a Sunday reminder to Monday morning', () => {
    // 13 Sep 2026 is a Sunday; a reminder landing on it waits for Monday.
    const preview = previewReminder(fromISTInput('2026-09-13T16:00'), 360, {
      suppressOutsideHours: true,
      workingHours: HOURS,
    });

    expect(preview.shifted).toBe(true);
    expect(preview.sentence).toContain('14 Sep 9:00 AM');
  });

  it('agrees with the engine rather than describing its own rule', () => {
    // Built on the same nextWorkingSlot the sweeper uses, so the line cannot
    // promise a time the engine would not pick.
    const custom = { ...HOURS, startMinutes: 10 * 60 };

    const preview = previewReminder(fromISTInput('2026-09-12T12:00'), 360, {
      suppressOutsideHours: true,
      workingHours: custom,
    });

    expect(preview.sentence).toContain('10:00 AM');
  });
});
