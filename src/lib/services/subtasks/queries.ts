/**
 * Read paths for subtasks.
 */
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/session';
import { notFound } from '@/lib/errors';
import { topologicalOrder } from '@/lib/domain/subtask-dependencies';
import { visibilityFilter } from '@/lib/services/jobs';

import { SUBTASK_SELECT, toSubtaskSummary, type SubtaskSummary } from './types';

/**
 * Every subtask on a job, in the order the shop floor works.
 *
 * Sorted by department `sequenceOrder` first — that is the timeline's band
 * order (SDD section 7.3) — with the dependency chain used to break ties, so
 * two Production tasks read in the order they actually run.
 *
 * @throws {AppError} `NOT_FOUND` when the caller may not see the job. Scoped by
 *         the same visibility rule as the job itself, so a member cannot
 *         enumerate subtasks on a job they are not part of.
 */
export async function listJobSubtasks(user: SessionUser, jobId: string): Promise<SubtaskSummary[]> {
  const job = await prisma.job.findFirst({
    where: { AND: [{ id: jobId }, visibilityFilter(user)] },
    select: { id: true },
  });
  if (!job) throw notFound('Job');

  const rows = await prisma.subtask.findMany({
    where: { jobId },
    select: SUBTASK_SELECT,
    orderBy: [{ department: { sequenceOrder: 'asc' } }, { deadline: 'asc' }],
  });

  const ordered = topologicalOrder(
    rows.map((row) => ({ id: row.id, dependsOnId: row.dependsOnId })),
  );
  const position = new Map(ordered.map((node, index) => [node.id, index]));
  const now = new Date();

  return [...rows]
    .sort((a, b) => {
      const bySequence = a.department.sequenceOrder - b.department.sequenceOrder;
      if (bySequence !== 0) return bySequence;
      return (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0);
    })
    .map((row) => toSubtaskSummary(row, now));
}

/**
 * One subtask, scoped through its job.
 *
 * @throws {AppError} `NOT_FOUND`
 */
export async function getSubtask(user: SessionUser, subtaskId: string): Promise<SubtaskSummary> {
  const row = await prisma.subtask.findFirst({
    where: { AND: [{ id: subtaskId }, { job: visibilityFilter(user) }] },
    select: SUBTASK_SELECT,
  });

  if (!row) throw notFound('Subtask');
  return toSubtaskSummary(row);
}

/** Loads a subtask for a mutation, ignoring visibility — the caller checks `can()`. */
export async function loadSubtaskForWrite(subtaskId: string) {
  const row = await prisma.subtask.findUnique({
    where: { id: subtaskId },
    select: SUBTASK_SELECT,
  });
  if (!row) throw notFound('Subtask');
  return row;
}

/** The history a drawer shows: deadline changes, newest first. */
export async function listDeadlineChanges(subtaskId: string) {
  return prisma.deadlineChange.findMany({
    where: { subtaskId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}
