/**
 * Typed browser-side calls for subtasks.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { SubtaskSummary } from '@/lib/services/subtasks';
import type {
  BulkCreateSubtasksInput,
  ChangeDeadlineInput,
  ReassignInput,
  SubtaskStatusChangeInput,
  UpdateSubtaskInput,
} from '@/lib/validation/subtask';

/** `SubtaskSummary` with dates as ISO strings — what crosses the wire. */
export type SubtaskDto = Omit<
  SubtaskSummary,
  'deadline' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt' | 'dependsOn'
> & {
  deadline: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  dependsOn: { id: string; title: string; status: string; deadline: string } | null;
};

export function fetchJobSubtasks(jobId: string): Promise<{ data: SubtaskDto[] }> {
  return apiFetch(`/api/jobs/${jobId}/subtasks`);
}

export function bulkCreateSubtasksRequest(
  jobId: string,
  input: BulkCreateSubtasksInput,
): Promise<{ data: string[]; count: number }> {
  return apiPost(`/api/jobs/${jobId}/subtasks`, input);
}

export function updateSubtaskRequest(
  id: string,
  input: UpdateSubtaskInput,
): Promise<{ subtask: SubtaskDto }> {
  return apiFetch(`/api/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function changeSubtaskStatusRequest(
  id: string,
  input: SubtaskStatusChangeInput,
): Promise<{ subtask: SubtaskDto; previousStatus: string; unblocked: string[] }> {
  return apiPost(`/api/subtasks/${id}/status`, input);
}

export function changeSubtaskDeadlineRequest(
  id: string,
  input: ChangeDeadlineInput,
): Promise<{ subtask: SubtaskDto }> {
  return apiPost(`/api/subtasks/${id}/deadline`, input);
}

export function reassignSubtaskRequest(
  id: string,
  input: ReassignInput,
): Promise<{ subtask: SubtaskDto }> {
  return apiPost(`/api/subtasks/${id}/reassign`, input);
}
