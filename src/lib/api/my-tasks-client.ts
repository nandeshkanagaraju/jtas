/**
 * Typed browser-side calls for the member workspace.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { BucketName } from '@/lib/domain/task-buckets';
import type { ExtensionRequestSummary } from '@/lib/services/extension-service';
import type { MyTask, MyTasksResult } from '@/lib/services/my-tasks-service';
import type { TaskSummary } from '@/lib/domain/task-buckets';
import type {
  CreateExtensionRequestInput,
  DecideExtensionRequestInput,
} from '@/lib/validation/extension';

/** `MyTask` with dates as ISO strings — what crosses the wire. */
export type MyTaskDto = Omit<
  MyTask,
  'deadline' | 'commitmentDueAt' | 'completedAt' | 'dependency'
> & {
  deadline: string | null;
  commitmentDueAt: string | null;
  completedAt: string | null;
  dependency:
    (Omit<NonNullable<MyTask['dependency']>, 'deadline'> & { deadline: string | null }) | null;
};

export type MyTasksDto = Omit<MyTasksResult, 'buckets' | 'now'> & {
  buckets: Record<BucketName, MyTaskDto[]>;
  summary: TaskSummary;
  now: string;
};

export type ExtensionRequestDto = Omit<
  ExtensionRequestSummary,
  'requestedDeadline' | 'decidedAt' | 'createdAt'
> & {
  requestedDeadline: string;
  decidedAt: string | null;
  createdAt: string;
};

export function fetchMyTasks(): Promise<MyTasksDto> {
  return apiFetch('/api/my/tasks');
}

export function fetchExtensionRequests(
  subtaskId: string,
): Promise<{ data: ExtensionRequestDto[] }> {
  return apiFetch(`/api/subtasks/${subtaskId}/extension-requests`);
}

export function requestExtensionRequest(
  subtaskId: string,
  input: CreateExtensionRequestInput,
): Promise<{ extensionRequest: ExtensionRequestDto }> {
  return apiPost(`/api/subtasks/${subtaskId}/extension-requests`, input);
}

export function decideExtensionRequestCall(
  requestId: string,
  input: DecideExtensionRequestInput,
): Promise<{ extensionRequest: ExtensionRequestDto }> {
  return apiPost(`/api/extension-requests/${requestId}/decide`, input);
}
