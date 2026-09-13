/**
 * What "on time" means — the single definition the whole system uses.
 *
 * Every number the MD sees on a dashboard, in a scorecard or in an export comes
 * from these rules. They live in one file because a metric that is computed two
 * ways is a metric nobody trusts: the moment the dashboard and the Excel export
 * disagree by one percentage point, both stop being evidence.
 *
 * The rules (build spec M8.6):
 *
 *   on time      completedAt <= the deadline in force at completion
 *   cancelled    excluded from every rate — nobody was late for work that was
 *                called off
 *   extended     judged against the CURRENT deadline, because that is what the
 *                department agreed to. `extensionCount` is reported alongside,
 *                so a task extended three times and then met cannot read as a
 *                clean 100%
 *
 * That last rule is a judgement, not a requirement: nothing in the PDD or SDD
 * says how an extension should appear in a metric. Improvement I-11 introduces
 * the extension *request flow* — "gives the honest member a legitimate path
 * instead of silence" — and stops there. Reporting the count beside the rate is
 * what stops that legitimate path from also being a way to launder a delay.
 */

/** A completed or still-open subtask, reduced to what the metrics need. */
export interface MeasurableSubtask {
  status: string;
  deadline: Date;
  completedAt: Date | null;
}

/** One deadline move, oldest or newest first — `deadlineInForceAt` sorts. */
export interface DeadlineMove {
  oldDeadline: Date;
  createdAt: Date;
}

/** Statuses excluded from every rate. */
export const EXCLUDED_FROM_METRICS = ['CANCELLED'] as const;

/** Whether this subtask counts towards a completion rate at all. */
export function isMeasurable(subtask: Pick<MeasurableSubtask, 'status'>): boolean {
  return !(EXCLUDED_FROM_METRICS as readonly string[]).includes(subtask.status);
}

/**
 * The deadline that applied at the moment of completion.
 *
 * In practice this is always the subtask's current `deadline`: `changeDeadline`
 * refuses a subtask that is already COMPLETED or CANCELLED, so no move can land
 * after `completedAt`. The rollback below is what makes that an assertion
 * rather than an assumption — if the guard is ever relaxed, a deadline extended
 * *after* the fact will not retroactively turn a late task into an on-time one.
 */
export function deadlineInForceAt(
  completedAt: Date,
  currentDeadline: Date,
  moves: readonly DeadlineMove[] = [],
): Date {
  let deadline = currentDeadline;

  // Newest first, rolling back through anything that happened after completion.
  const later = [...moves]
    .filter((move) => move.createdAt.getTime() > completedAt.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const move of later) deadline = move.oldDeadline;

  return deadline;
}

/**
 * Whether a subtask was finished by its deadline.
 *
 * Returns false for anything not yet complete: "not late yet" is not "on time",
 * and counting open work as on time would make the rate climb as the backlog
 * grows.
 */
export function isOnTime(subtask: MeasurableSubtask, moves: readonly DeadlineMove[] = []): boolean {
  if (!subtask.completedAt || !isMeasurable(subtask)) return false;

  const deadline = deadlineInForceAt(subtask.completedAt, subtask.deadline, moves);

  // Exactly on the deadline is on time. A minute past it is not.
  return subtask.completedAt.getTime() <= deadline.getTime();
}

/**
 * How late a subtask was, in hours. Zero when it was on time or early.
 *
 * Never negative: "three hours early" and "on time" are the same fact for a
 * delay average, and letting early work offset late work would hide the delays
 * this system exists to surface.
 */
export function delayHours(
  subtask: MeasurableSubtask,
  moves: readonly DeadlineMove[] = [],
): number {
  if (!subtask.completedAt || !isMeasurable(subtask)) return 0;

  const deadline = deadlineInForceAt(subtask.completedAt, subtask.deadline, moves);
  const ms = subtask.completedAt.getTime() - deadline.getTime();

  return ms <= 0 ? 0 : ms / 3_600_000;
}

/** How overdue an unfinished subtask is right now, in hours. Zero if not yet due. */
export function overdueHours(subtask: Pick<MeasurableSubtask, 'deadline'>, now: Date): number {
  const ms = now.getTime() - subtask.deadline.getTime();
  return ms <= 0 ? 0 : ms / 3_600_000;
}

/** A completion rate and the counts behind it. */
export interface OnTimeSummary {
  completed: number;
  onTime: number;
  late: number;
  /** 0–100, rounded to one decimal. `null` when nothing has been completed. */
  onTimePercent: number | null;
  /** Mean lateness across completed work, late and on-time alike. */
  averageDelayHours: number;
}

/**
 * Summarises a set of subtasks.
 *
 * `onTimePercent` is `null` rather than 0 or 100 when nothing has completed. A
 * department that has finished nothing has no record, and showing it as 0%
 * would rank it below one that is genuinely failing.
 */
export function summarise(
  subtasks: readonly MeasurableSubtask[],
  movesBySubtask: ReadonlyMap<string, readonly DeadlineMove[]> = new Map(),
  idOf: (subtask: MeasurableSubtask, index: number) => string = (_, index) => String(index),
): OnTimeSummary {
  const completed = subtasks.filter((s) => s.completedAt && isMeasurable(s));

  let onTime = 0;
  let totalDelay = 0;

  completed.forEach((subtask, index) => {
    const moves = movesBySubtask.get(idOf(subtask, index)) ?? [];
    if (isOnTime(subtask, moves)) onTime++;
    totalDelay += delayHours(subtask, moves);
  });

  return {
    completed: completed.length,
    onTime,
    late: completed.length - onTime,
    onTimePercent: completed.length === 0 ? null : round1((onTime / completed.length) * 100),
    averageDelayHours: completed.length === 0 ? 0 : round1(totalDelay / completed.length),
  };
}

/** One decimal place — more precision than that is noise on a dashboard. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The percentage, given counts that were aggregated in SQL.
 *
 * The dashboard counts on-time work in the database rather than loading every
 * row, so it needs the same rounding as {@link summarise} without the rows.
 */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return round1((part / whole) * 100);
}
