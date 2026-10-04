/**
 * Derived job status — SDD section 4.2.
 *
 * A pure function over already-loaded rows, with no database access and no
 * clock of its own. That is deliberate: this ladder decides what the MD sees on
 * the dashboard, it is recomputed after every subtask change, and it has to be
 * exhaustively testable without fixtures.
 *
 * The persistence wrapper lives in `@/lib/services/jobs/status.ts`.
 */
import type { JobStatus, SubtaskStatus } from '@prisma/client';

/** The subtask fields the ladder actually depends on. */
export interface SubtaskSnapshot {
  status: SubtaskStatus;
  /** UTC instant. Null until a date is committed — a blank is not overdue. */
  deadline: Date | null;
}

export interface JobStatusInput {
  /** The job's stored status, which gates the manual states below. */
  currentStatus: JobStatus;
  /** UTC instant. */
  overallDeadline: Date;
  subtasks: readonly SubtaskSnapshot[];
  /** Injected so tests can freeze it. */
  now: Date;
}

/**
 * A subtask is terminal once it is completed or cancelled — it needs no owner
 * and can never become overdue.
 */
const TERMINAL: readonly SubtaskStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Statuses a human sets and the system must not overwrite.
 *
 * `DRAFT` ends only at publish; `ON_HOLD` only at unhold (FR-14 — a held job's
 * timers pause, so recomputing it to `DELAYED` would defeat the hold);
 * `CANCELLED` is terminal.
 */
const MANUAL: readonly JobStatus[] = ['DRAFT', 'ON_HOLD', 'CANCELLED'];

/**
 * "Overdue" is a derived condition, never a stored status (PDD improvement
 * I-08) — so a subtask can be simultaneously `IN_PROGRESS` and overdue, and the
 * history stays honest about what the person was actually doing.
 */
export function isSubtaskOverdue(subtask: SubtaskSnapshot, now: Date): boolean {
  if (TERMINAL.includes(subtask.status)) return false;
  if (!subtask.deadline) return false;
  return now.getTime() > subtask.deadline.getTime();
}

/** How close to the overall deadline a job starts reading as at risk. */
export const AT_RISK_WINDOW_HOURS = 24;

/**
 * Applies the SDD section 4.2 ladder.
 *
 * ```
 * all subtasks CANCELLED                         -> CANCELLED
 * all subtasks COMPLETED/CANCELLED               -> COMPLETED
 * any subtask overdue                            -> DELAYED
 * any subtask has an open problem                -> AT_RISK
 * within 24h of the overall deadline, not done   -> AT_RISK
 * otherwise                                      -> IN_PROGRESS
 * ```
 *
 * Order matters and is the SDD's: a job that is both overdue and carrying a
 * problem reads as `DELAYED`, because the delay is the fact the MD has to act
 * on first.
 */
export function deriveJobStatus(input: JobStatusInput): JobStatus {
  const { currentStatus, overallDeadline, subtasks, now } = input;

  // Manual states win over anything derived.
  if (MANUAL.includes(currentStatus)) return currentStatus;

  // A published job always has at least one subtask, so this is defensive
  // rather than reachable: with nothing to measure, nothing is derivable.
  if (subtasks.length === 0) return 'IN_PROGRESS';

  /*
   * SDD 4.2 line 1 reads "if any subtask CANCELLED-all -> CANCELLED", which is
   * garbled. It is read here as "if ALL subtasks are cancelled" — the other
   * reading, that a single cancelled subtask cancels the whole job, would let
   * dropping one department's task silently kill a live order. Noted in
   * docs/DEFERRED.md for the MD to confirm.
   */
  if (subtasks.every((subtask) => subtask.status === 'CANCELLED')) return 'CANCELLED';

  if (subtasks.every((subtask) => TERMINAL.includes(subtask.status))) return 'COMPLETED';

  if (subtasks.some((subtask) => isSubtaskOverdue(subtask, now))) return 'DELAYED';

  if (subtasks.some((subtask) => subtask.status === 'PROBLEM')) return 'AT_RISK';

  const atRiskFrom = overallDeadline.getTime() - AT_RISK_WINDOW_HOURS * 3_600_000;
  if (now.getTime() > atRiskFrom) return 'AT_RISK';

  return 'IN_PROGRESS';
}

/** Progress for the jobs list: how much of the work is finished. */
export function jobProgress(subtasks: readonly SubtaskSnapshot[]): {
  completed: number;
  total: number;
  percent: number;
} {
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.status === 'COMPLETED').length;

  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
