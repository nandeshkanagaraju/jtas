/**
 * Typed browser-side calls for the user directory.
 *
 * Kept out of the components so that a screen never constructs a URL or a body
 * by hand, and so the response shapes have one definition.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { UserSummary } from '@/lib/services/users';
import type { DepartmentSummary } from '@/lib/services/department-service';
import type { Paginated } from '@/lib/validation/common';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from '@/lib/validation/user';

/**
 * `UserSummary` with dates as ISO strings — what actually crosses the wire once
 * `NextResponse.json` has serialised it.
 */
export type UserRow = Omit<UserSummary, 'lastLoginAt' | 'lockedUntil' | 'createdAt'> & {
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
};

export interface OpenSubtaskSummary {
  id: string;
  title: string;
  status: string;
  deadline: string;
  jobId: string;
  jobCode: string;
  departmentName: string;
}

export function buildUsersQuery(filters: Partial<ListUsersQuery>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  return params.toString();
}

export function fetchUsers(filters: Partial<ListUsersQuery>): Promise<Paginated<UserRow>> {
  return apiFetch(`/api/users?${buildUsersQuery(filters)}`);
}

export function fetchDepartments(): Promise<{ data: DepartmentSummary[] }> {
  return apiFetch('/api/departments');
}

export function createUserRequest(
  input: CreateUserInput,
): Promise<{ user: UserRow; temporaryPassword: string }> {
  return apiPost('/api/users', input);
}

export function updateUserRequest(id: string, input: UpdateUserInput): Promise<{ user: UserRow }> {
  return apiFetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deactivateUserRequest(
  id: string,
  body: { reassignTo?: string | null; reason?: string },
): Promise<{
  user: UserRow;
  reassignedTo: { id: string; name: string } | null;
  reassignedSubtaskCount: number;
}> {
  return apiFetch(`/api/users/${id}`, { method: 'DELETE', body: JSON.stringify(body) });
}

export function reactivateUserRequest(id: string): Promise<{ user: UserRow }> {
  return apiPost(`/api/users/${id}/reactivate`, {});
}

export function resetPasswordRequest(
  id: string,
): Promise<{ user: UserRow; temporaryPassword: string }> {
  return apiPost(`/api/users/${id}/reset-password`, {});
}
