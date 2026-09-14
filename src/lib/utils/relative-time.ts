/**
 * Human-readable "due in" labels for deadlines.
 *
 * A deadline shown only as `15 Oct 2026, 04:30 PM` makes the reader do the
 * arithmetic. On a shop floor the question is always "how long have I got?", so
 * the relative label carries the urgency and the absolute time stays alongside
 * it for precision.
 */
import { hoursBetween } from './time';

export type DeadlineTone = 'overdue' | 'urgent' | 'soon' | 'normal';

export interface DeadlineLabel {
  /** e.g. "in 3 days", "in 5 h", "2 days late". */
  text: string;
  tone: DeadlineTone;
  overdue: boolean;
}

/** Rounds to the largest sensible unit — nobody needs "in 51 hours". */
function describe(hours: number): string {
  const absolute = Math.abs(hours);

  if (absolute < 1) {
    const minutes = Math.max(1, Math.round(absolute * 60));
    return `${minutes} min`;
  }
  if (absolute < 48) {
    return `${Math.round(absolute)} h`;
  }

  const days = Math.round(absolute / 24);
  if (days < 14) return `${days} days`;

  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks} weeks`;

  return `${Math.round(days / 30)} months`;
}

/**
 * Describes how far `deadline` is from `now`.
 *
 * Tone thresholds match the colour rules in SDD section 7.4: rose once a
 * deadline has passed, amber inside a day, sky inside three.
 */
export function deadlineLabel(deadline: Date, now: Date = new Date()): DeadlineLabel {
  const hours = hoursBetween(now, deadline);

  if (hours < 0) {
    return { text: `${describe(hours)} late`, tone: 'overdue', overdue: true };
  }

  const tone: DeadlineTone = hours <= 24 ? 'urgent' : hours <= 72 ? 'soon' : 'normal';

  return { text: `in ${describe(hours)}`, tone, overdue: false };
}

/**
 * Describes a *finished* piece of work against the deadline it had.
 *
 * `deadlineLabel` measures from now, which is right until the work is done and
 * wrong the moment it is: a job completed two days early still has a deadline
 * in the past, so the list marked it "6 days late" in red while the dashboard
 * called it on time. The two screens disagreeing about the same job is the
 * fastest way to lose the MD's trust in both.
 */
export function completionLabel(deadline: Date, completedAt: Date): DeadlineLabel {
  const hours = hoursBetween(completedAt, deadline);

  if (hours < 0) {
    return { text: `finished ${describe(hours)} late`, tone: 'overdue', overdue: true };
  }

  return { text: `finished ${describe(hours)} early`, tone: 'normal', overdue: false };
}
