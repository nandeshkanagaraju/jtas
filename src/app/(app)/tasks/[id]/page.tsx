import type { Metadata } from 'next';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { listExtensionRequests } from '@/lib/services/extension-service';
import { getSubtask } from '@/lib/services/subtasks';

import { TaskDetail } from './task-detail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireActiveSession();
  const { id } = await params;

  try {
    const subtask = await getSubtask(session, id);
    return { title: `${subtask.title} — ${subtask.jobCode}` };
  } catch {
    return { title: 'Task' };
  }
}

/**
 * The member's subtask screen — SDD section 7.2.
 *
 * "The whole point is speed." Everything needed to act is above the fold, and
 * the deep links the M7 emails use (`?action=complete`, `?action=problem`) open
 * this screen with that control already expanded.
 */
export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const session = await requireActiveSession();
  const { id } = await params;
  const { action } = await searchParams;

  // `getSubtask` is scoped through the job, so a member who is not on the job
  // gets NOT_FOUND rather than a refusal that confirms the task exists.
  const subtask = await getSubtask(session, id);

  const participants = await prisma.subtask.findMany({
    where: { jobId: subtask.jobId },
    select: { assigneeId: true },
    distinct: ['assigneeId'],
  });

  const resource = {
    id: subtask.id,
    jobId: subtask.jobId,
    assigneeId: subtask.assignee.id,
    departmentId: subtask.department.id,
    jobParticipantIds: participants.map((row) => row.assigneeId),
  };

  if (!can(session, 'subtask:view', resource)) forbidden();

  /*
   * Read-only for everybody but the owner (build spec M5.5). Decided by the
   * policy function, not by the UI — a sibling department sees the work and
   * cannot touch it.
   */
  const permissions = {
    updateStatus: can(session, 'subtask:updateStatus', resource),
    raiseProblem: can(session, 'problem:raise', resource),
    requestExtension: can(session, 'subtask:requestExtension', resource),
    // M10: commenting is scoped to the job, attaching to the subtask.
    comment: can(session, 'comment:create', resource),
    attach: can(session, 'attachment:create', resource),
  };

  const extensionRequests = permissions.requestExtension ? await listExtensionRequests(id) : [];

  return (
    <TaskDetail
      currentUserId={session.id}
      subtask={{
        ...subtask,
        deadline: subtask.deadline.toISOString(),
        startedAt: subtask.startedAt?.toISOString() ?? null,
        completedAt: subtask.completedAt?.toISOString() ?? null,
        createdAt: subtask.createdAt.toISOString(),
        updatedAt: subtask.updatedAt.toISOString(),
        dependsOn: subtask.dependsOn
          ? { ...subtask.dependsOn, deadline: subtask.dependsOn.deadline.toISOString() }
          : null,
        openProblem: subtask.openProblem
          ? { ...subtask.openProblem, createdAt: subtask.openProblem.createdAt.toISOString() }
          : null,
      }}
      permissions={permissions}
      initialAction={action === 'complete' || action === 'problem' ? action : null}
      extensionRequests={extensionRequests.map((request) => ({
        ...request,
        requestedDeadline: request.requestedDeadline.toISOString(),
        decidedAt: request.decidedAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
      }))}
    />
  );
}
