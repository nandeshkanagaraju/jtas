/**
 * Validation shared by every subtask mutation.
 *
 * Two of these rules deliberately *warn* rather than block, and only become
 * errors until the MD supplies a reason (build spec M4.2):
 *
 *  - a deadline after the job's own (FR-23), and
 *  - an assignee from another department.
 *
 * Both are sometimes genuinely correct — a rework loop legitimately runs past
 * the original date, and a Quality inspector legitimately covers for Production
 * — so refusing outright would teach people to work around the tool. Refusing
 * *until they say why* keeps the record honest instead.
 */
import type { Db } from '@/lib/db/prisma';
import { validationError } from '@/lib/errors';
import { wouldCreateCycle } from '@/lib/domain/subtask-dependencies';
import { formatIST, fromISTInput } from '@/lib/utils/time';

/**
 * Converts the naive IST wall-clock string the client sends into a UTC instant.
 *
 * Goes through `fromISTInput`, never `new Date(string)` — architecture rule 1.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export function parseSubtaskDeadline(
  value: string,
  options: { field?: string; now?: Date; requireFuture?: boolean } = {},
): Date {
  const field = options.field ?? 'deadline';
  let deadline: Date;

  try {
    deadline = fromISTInput(value);
  } catch {
    throw validationError('That is not a valid date and time.', {
      fields: { [field]: ['Choose a date and time.'] },
    });
  }

  if (options.requireFuture !== false) {
    const now = options.now ?? new Date();
    if (deadline.getTime() <= now.getTime()) {
      throw validationError('The deadline must be in the future.', {
        fields: { [field]: [`Choose a time after ${formatIST(now)}.`] },
      });
    }
  }

  return deadline;
}

/**
 * FR-23: a subtask deadline should not exceed the job's overall deadline.
 *
 * Warns by refusing until an override reason is given, and returns whether the
 * override was used so the caller can record it.
 *
 * @throws {AppError} `VALIDATION_ERROR` when it exceeds and no reason was given.
 */
export function assertDeadlineWithinJob(
  deadline: Date,
  jobDeadline: Date,
  overrideReason: string | undefined,
  field = 'deadline',
): boolean {
  if (deadline.getTime() <= jobDeadline.getTime()) return false;

  if (!overrideReason) {
    throw validationError(
      `That is after the job's own deadline of ${formatIST(jobDeadline)}. Confirm with a reason if you mean it.`,
      {
        reason: 'DEADLINE_AFTER_JOB',
        jobDeadline: jobDeadline.toISOString(),
        requiresOverride: 'deadlineOverrideReason',
        fields: { [field]: ['This is after the job deadline.'] },
      },
    );
  }

  return true;
}

/**
 * The assignee must be active, must not be an administrator, and should belong
 * to the subtask's department.
 *
 * @returns whether the department mismatch was overridden.
 * @throws {AppError} `VALIDATION_ERROR`
 */
export async function assertAssignable(
  db: Db,
  assigneeId: string,
  departmentId: string,
  overrideReason: string | undefined,
  field = 'assigneeId',
): Promise<boolean> {
  const assignee = await db.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, name: true, role: true, departmentId: true, isActive: true },
  });

  if (!assignee) {
    throw validationError('That user does not exist.', {
      fields: { [field]: ['That user does not exist.'] },
    });
  }

  if (!assignee.isActive) {
    throw validationError(`${assignee.name} is deactivated and cannot be assigned work.`, {
      fields: { [field]: ['Choose an active user.'] },
    });
  }

  if (assignee.role === 'ADMIN') {
    // `can()` refuses an administrator `subtask:updateStatus`, so a subtask
    // assigned to one could never be completed by anybody.
    throw validationError(`${assignee.name} is an administrator and cannot be assigned subtasks.`, {
      fields: { [field]: ['Choose a member, the MD, or the deputy.'] },
    });
  }

  if (assignee.departmentId === departmentId) return false;

  if (!overrideReason) {
    throw validationError(
      `${assignee.name} is not in this department. Confirm with a reason if you mean it.`,
      {
        reason: 'ASSIGNEE_OUTSIDE_DEPARTMENT',
        requiresOverride: 'assigneeOverrideReason',
        fields: { [field]: ['This person is in another department.'] },
      },
    );
  }

  return true;
}

/**
 * A dependency must belong to the same job and must not close a cycle.
 *
 * Unlike the two rules above this one has no override: a cycle is never
 * correct, and the subtasks in it would wait for each other forever.
 *
 * @throws {AppError} `VALIDATION_ERROR`
 */
export async function assertDependencyValid(
  db: Db,
  jobId: string,
  subtaskId: string | null,
  dependsOnId: string,
  field = 'dependsOnId',
): Promise<void> {
  if (subtaskId && dependsOnId === subtaskId) {
    throw validationError('A subtask cannot wait for itself.', {
      reason: 'DEPENDENCY_CYCLE',
      fields: { [field]: ['A subtask cannot wait for itself.'] },
    });
  }

  const dependency = await db.subtask.findUnique({
    where: { id: dependsOnId },
    select: { id: true, jobId: true, title: true },
  });

  if (!dependency) {
    throw validationError('That subtask does not exist.', {
      fields: { [field]: ['That subtask does not exist.'] },
    });
  }

  if (dependency.jobId !== jobId) {
    throw validationError('A subtask can only depend on another subtask of the same job.', {
      reason: 'DEPENDENCY_OTHER_JOB',
      fields: { [field]: ['Choose a subtask from this job.'] },
    });
  }

  // Nothing can form a cycle with a row that does not exist yet, so a create
  // only needs the checks above.
  if (!subtaskId) return;

  const nodes = await db.subtask.findMany({
    where: { jobId },
    select: { id: true, dependsOnId: true },
  });

  if (wouldCreateCycle(nodes, subtaskId, dependsOnId)) {
    throw validationError(
      `That would make the two subtasks wait for each other. "${dependency.title}" already depends on this one, directly or through the chain.`,
      { reason: 'DEPENDENCY_CYCLE', fields: { [field]: ['This would create a loop.'] } },
    );
  }
}
