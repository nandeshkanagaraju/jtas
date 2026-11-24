import type { Metadata } from 'next';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';
import { jobListStatusSchema } from '@/lib/validation/job';

import { JobsScreen } from './components/jobs-screen';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

/**
 * The jobs list.
 *
 * Open to any signed-in user, because the list itself is scoped: a member sees
 * only jobs they hold a subtask on, enforced in the query (build spec M3.2).
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const session = await requireActiveSession();
  const departments = await listDepartments();

  const { status } = await searchParams;
  const initialStatus = jobListStatusSchema.safeParse(status).data;
  return (
    <JobsScreen
      key={initialStatus}
      departments={departments}
      canCreate={can(session, 'job:create', undefined)}
      initialStatus={initialStatus}
    />
  );
}
