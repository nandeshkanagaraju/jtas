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
