/**
 * The settings screen's live preview line (build spec M9.2).
 *
 * "A task due 13 Sep 6:00 PM will remind at 13 Sep 12:00 PM." The point is that
 * an operator changing the lead time or the working window can see the result
 * before saving, rather than discovering it when a member is reminded at a time
 * nobody intended.
 *
 * Pure, and built on the same `nextWorkingSlot` the sweeper uses, so the line
 * cannot promise a time the engine would not actually pick.
 */
import { nextWorkingSlot, type WorkingHoursConfig } from '@/lib/notifications/working-hours';
import { formatIST } from '@/lib/utils/time';

export interface ReminderPreview {
  deadline: Date;
  /** When the reminder would fire if working hours were ignored. */
  rawAt: Date;
  /** When it actually fires. */
  at: Date;
  /** True when the working-hours rule moved it. */
  shifted: boolean;
  sentence: string;
}

export function previewReminder(
  deadline: Date,
  leadMinutes: number,
  options: { suppressOutsideHours: boolean; workingHours: WorkingHoursConfig },
): ReminderPreview {
  const rawAt = new Date(deadline.getTime() - leadMinutes * 60_000);

  const at = options.suppressOutsideHours ? nextWorkingSlot(rawAt, options.workingHours) : rawAt;
  const shifted = at.getTime() !== rawAt.getTime();

  const due = formatIST(deadline, 'd MMM h:mm a');
  const remind = formatIST(at, 'd MMM h:mm a');

  const sentence = shifted
    ? `A task due ${due} would remind at ${formatIST(rawAt, 'd MMM h:mm a')}, which is outside working hours — so it will remind at ${remind}.`
    : `A task due ${due} will remind at ${remind}.`;

  return { deadline, rawAt, at, shifted, sentence };
}
