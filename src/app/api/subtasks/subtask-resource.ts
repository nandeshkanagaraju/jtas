/**
 * Builds the `SubtaskResource` the policy needs.
 *
 * Pure: everything `can()` decides a subtask question on is already on the row,
 * so unlike the job resource this needs no query.
 *
 * Accepts both shapes the service returns — the raw row, which carries flat
 * foreign keys, and the API summary, which nests the assignee and department —
 * so a caller never has to reshape before asking a permission question.
 */
import type { SubtaskResource } from '@/lib/auth/policy';
import { prisma } from '@/lib/db/prisma';

type FlatSubtask = {
  id: string;
  jobId: string;
  assigneeId: string;
  departmentId: string;
};

type NestedSubtask = {
  id: string;
  jobId: string;
  assignee: { id: string };
  department: { id: string };
};

export function subtaskResource(subtask: FlatSubtask | NestedSubtask): SubtaskResource {
  const assigneeId = 'assigneeId' in subtask ? subtask.assigneeId : subtask.assignee.id;
  const departmentId = 'departmentId' in subtask ? subtask.departmentId : subtask.department.id;

  return { id: subtask.id, jobId: subtask.jobId, assigneeId, departmentId };
}

/**
 * The same resource, plus the ids of everyone holding a subtask on the job.
 *
 * `subtask:view` needs that list to grant a member read-only sight of a sibling
 * department's work (build spec M5.5, PDD section 13 question 3). It costs one
 * extra query, so it is used only on the read paths — the write paths decide on
 * ownership and do not need it.
 */
export async function subtaskViewResource(
  subtask: FlatSubtask | NestedSubtask,
): Promise<SubtaskResource> {
  const base = subtaskResource(subtask);

  const participants = await prisma.subtask.findMany({
    where: { jobId: base.jobId },
    select: { assigneeId: true },
    distinct: ['assigneeId'],
  });

  return { ...base, jobParticipantIds: participants.map((row) => row.assigneeId) };
}
