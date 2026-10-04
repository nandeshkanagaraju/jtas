/**
 * Typed browser-side calls for the problem inbox.
 */
import { apiFetch, apiPost } from '@/lib/api/client';
import type { ProblemInbox, ProblemSummary } from '@/lib/services/problems';
import type {
  ListProblemsQuery,
  RejectProblemInput,
  ResolveProblemInput,
} from '@/lib/validation/problem';

/** `ProblemSummary` with dates as ISO strings — what crosses the wire. */
export type ProblemDto = Omit<
  ProblemSummary,
  'acknowledgedAt' | 'resolvedAt' | 'createdAt' | 'subtask'
> & {
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  subtask: Omit<ProblemSummary['subtask'], 'deadline'> & { deadline: string | null };
};

export type ProblemInboxDto = Omit<ProblemInbox, 'data'> & { data: ProblemDto[] };

export function buildProblemsQuery(filters: Partial<ListProblemsQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export function fetchProblems(filters: Partial<ListProblemsQuery>): Promise<ProblemInboxDto> {
  return apiFetch(`/api/problems?${buildProblemsQuery(filters)}`);
}

export function acknowledgeProblemRequest(id: string): Promise<{ problem: ProblemDto }> {
  return apiPost(`/api/problems/${id}/acknowledge`, {});
}

export function resolveProblemRequest(
  id: string,
  input: ResolveProblemInput,
): Promise<{ problem: ProblemDto; action: string; escalatedSubtaskId: string | null }> {
  return apiPost(`/api/problems/${id}/resolve`, input);
}

export function rejectProblemRequest(
  id: string,
  input: RejectProblemInput,
): Promise<{ problem: ProblemDto }> {
  return apiPost(`/api/problems/${id}/reject`, input);
}
