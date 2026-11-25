/**
 * Members who create and maintain jobs on the MD's behalf.
 *
 * Listed by sign-in email in `JOB_MANAGER_EMAILS`, so the grant can be given
 * and taken back with a settings change rather than a release. It covers jobs
 * only: creating, planning, publishing, editing, holding, cancelling,
 * reassigning and re-dating. Approvals, problem decisions, users, passwords,
 * billing and settings stay with the MD. The rules are in `policy.ts`.
 */
import { env } from '@/lib/utils/env';

function jobManagerEmails(): Set<string> {
  return new Set(
    (env().JOB_MANAGER_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isJobManager(user: { email: string }): boolean {
  return jobManagerEmails().has(user.email.trim().toLowerCase());
}
