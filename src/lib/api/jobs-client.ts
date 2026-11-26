/**
 * Typed browser-side calls for jobs.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { JobListResult, JobSummary } from '@/lib/services/jobs';
import type { CreateJobInput, ListJobsQuery, UpdateJobInput } from '@/lib/validation/job';

/** `JobSummary` with dates as ISO strings — what crosses the wire. */
export type JobRowDto = Omit<
  JobSummary,
  | 'overallDeadline'
  | 'publishedAt'
  | 'completedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'accountsIntimation'
> & {
  accountsIntimation: { at: string; by: string | null; note: string | null } | null;
  overallDeadline: string;
  publishedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobListDto = Omit<JobListResult, 'data'> & { data: JobRowDto[] };

export function buildJobsQuery(filters: Partial<ListJobsQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function fetchJobs(filters: Partial<ListJobsQuery>): Promise<JobListDto> {
  return apiFetch(`/api/jobs?${buildJobsQuery(filters)}`);
}

export function createJobRequest(input: CreateJobInput): Promise<{ job: JobRowDto }> {
  return apiPost('/api/jobs', input);
}

export function updateJobRequest(id: string, input: UpdateJobInput): Promise<{ job: JobRowDto }> {
  return apiFetch(`/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function publishJobRequest(id: string): Promise<{ job: JobRowDto }> {
  return apiPost(`/api/jobs/${id}/publish`, {});
}

export function holdJobRequest(id: string, reason: string): Promise<{ job: JobRowDto }> {
  return apiPost(`/api/jobs/${id}/hold`, { reason });
}

export function unholdJobRequest(id: string): Promise<{ job: JobRowDto }> {
  return apiPost(`/api/jobs/${id}/unhold`, {});
}

export function cancelJobRequest(id: string, reason: string): Promise<{ job: JobRowDto }> {
  return apiPost(`/api/jobs/${id}/cancel`, { reason });
}

/** Deletes a cancelled job or a draft. */
export function deleteJobRequest(id: string, reason: string): Promise<{ deleted: true }> {
  return apiFetch(`/api/jobs/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
}

/** Planning tells Accounts the job is ready to invoice. */
export function intimateAccountsRequest(
  id: string,
  note?: string,
): Promise<{ data: { at: string; by: string; note: string | null } }> {
  return apiPost(`/api/jobs/${id}/intimate-accounts`, { note });
}
