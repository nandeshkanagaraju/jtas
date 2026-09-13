/**
 * Turning a template into dated subtasks — FR-11.
 *
 * Pure, so the wizard can preview the whole chain before anything is written
 * and the same arithmetic can be reused server-side later.
 */
import { formatIST } from '@/lib/utils/time';

export interface TemplateScheduleItem {
  order: number;
  offsetHoursBeforeDue: number;
  dependsOnItemOrder: number | null;
}

export interface ScheduledItem<T extends TemplateScheduleItem> {
  item: T;
  /** Naive IST wall-clock string, ready for the form and the API. */
  deadline: string;
  /** True when the computed deadline has already passed. */
  inThePast: boolean;
}

/**
 * Computes each item's deadline as `jobDeadline − offsetHoursBeforeDue`.
 *
 * Offsets are hours rather than days so a short job still spreads sensibly, and
 * the result is rendered as an IST wall-clock string because that is what
 * crosses the wire (architecture rule 1).
 *
 * An offset larger than the time remaining produces a deadline in the past;
 * that is reported rather than silently clamped, because the honest answer is
 * "this job is too short for this template" and the MD needs to see it.
 */
export function scheduleFromTemplate<T extends TemplateScheduleItem>(
  items: readonly T[],
  jobDeadline: Date,
  now: Date = new Date(),
): Array<ScheduledItem<T>> {
  return items.map((item) => {
    const deadline = new Date(jobDeadline.getTime() - item.offsetHoursBeforeDue * 3_600_000);

    return {
      item,
      deadline: formatIST(deadline, "yyyy-MM-dd'T'HH:mm"),
      inThePast: deadline.getTime() <= now.getTime(),
    };
  });
}
