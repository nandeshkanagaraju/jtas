/**
 * The parts of the problem lifecycle that a subtask status change also needs.
 *
 * Deliberately free of any import from the subtask service. Raising a problem
 * happens through `changeStatus` — the state machine owns the transition — and
 * `raiseProblem` is a wrapper over it. If the shared pieces lived in that
 * wrapper the two modules would import each other; keeping them here means the
 * dependency runs one way only.
 */
import type { ProblemSeverity } from '@prisma/client';

import type { Db } from '@/lib/db/prisma';
import { conflict } from '@/lib/errors';
import { writeAudit } from '@/lib/services/audit-service';
import { notifyProblemRaised, problemRecipientIds } from '@/lib/services/notification-service';

/** A problem still needing a decision. */
export const LIVE_PROBLEM_STATUSES = ['OPEN', 'ACKNOWLEDGED'] as const;

/**
 * One live problem per subtask (build spec M6.1).
 *
 * A second one would split the MD's attention across two records describing the
 * same stuck piece of work, and there would be no answer to "which of these am
 * I deciding?". The member adds to the existing one instead.
 *
 * @throws {AppError} `CONFLICT` naming the existing problem.
 */
export async function assertNoLiveProblem(db: Db, subtaskId: string): Promise<void> {
  const existing = await db.problem.findFirst({
    where: { subtaskId, status: { in: [...LIVE_PROBLEM_STATUSES] } },
    select: { id: true, status: true, createdAt: true },
  });

  if (existing) {
    throw conflict(
      'A problem has already been reported on this task and the MD has not closed it yet.',
      {
        reason: 'PROBLEM_ALREADY_OPEN',
        problemId: existing.id,
        status: existing.status,
        raisedAt: existing.createdAt.toISOString(),
      },
    );
  }
}

export interface CreateProblemInput {
  subtaskId: string;
  raisedById: string;
  description: string;
  severity: ProblemSeverity;
  ipAddress: string | null;
  source?: 'WEB' | 'TELEGRAM';
}

/**
 * Writes the problem row, its audit entry, and the notification to the MD.
 *
 * Called from inside the `changeStatus` transaction, so the subtask reaching
 * `PROBLEM` and the record of why commit together — a subtask sitting in
 * `PROBLEM` with no problem row would be unexplainable.
 */
export async function createProblem(db: Db, input: CreateProblemInput): Promise<{ id: string }> {
  const problem = await db.problem.create({
    data: {
      subtaskId: input.subtaskId,
      raisedById: input.raisedById,
      description: input.description,
      severity: input.severity,
      status: 'OPEN',
    },
    select: { id: true },
  });

  await writeAudit(db, {
    actorId: input.raisedById,
    action: 'PROBLEM_RAISED',
    entityType: 'PROBLEM',
    entityId: problem.id,
    after: {
      subtaskId: input.subtaskId,
      severity: input.severity,
      description: input.description,
    },
    ipAddress: input.ipAddress,
    source: input.source ?? 'WEB',
  });

  // FR-40: the MD and every deputy hear about it immediately.
  await notifyProblemRaised(db, {
    problemId: problem.id,
    subtaskId: input.subtaskId,
    severity: input.severity,
    description: input.description,
    recipientIds: await problemRecipientIds(db),
  });

  return problem;
}
