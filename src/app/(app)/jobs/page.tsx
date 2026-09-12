import type { Metadata } from 'next';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';

import { JobsScreen } from './components/jobs-screen';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

/**
 * The jobs list.
 *
 * Open to any signed-in user, because the list itself is scoped: a member sees
 * only jobs they hold a subtask on, enforced in the query (build spec M3.2).
 */
export default async function JobsPage() {
  const session = await requireActiveSession();
  const departments = await listDepartments();

  return <JobsScreen departments={departments} canCreate={can(session, 'job:create', undefined)} />;
}
