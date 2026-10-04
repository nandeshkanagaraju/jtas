import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';
import { listProblems } from '@/lib/services/problems';
import { listUsers } from '@/lib/services/users';

import { ProblemsScreen } from './components/problems-screen';

export const metadata: Metadata = { title: 'Problems' };
export const dynamic = 'force-dynamic';

/**
 * The MD's problem inbox (FR-41).
 *
 * Rendered on the server with the first page already in place: the success
 * metric is a median under two hours from raise to decision, and a spinner
 * between the MD and the queue works against that.
 */
export default async function ProblemsPage() {
  const session = await requireActiveSession();
  if (!can(session, 'dashboard:md', undefined)) forbidden();

  const [inbox, departments, users] = await Promise.all([
    listProblems({ open: true }),
    listDepartments(),
    listUsers({ page: 1, pageSize: 100, status: 'active', sort: 'name', direction: 'asc' }),
  ]);

  return (
    <ProblemsScreen
      initial={{
        counts: inbox.counts,
        data: inbox.data.map((problem) => ({
          ...problem,
          acknowledgedAt: problem.acknowledgedAt?.toISOString() ?? null,
          resolvedAt: problem.resolvedAt?.toISOString() ?? null,
          createdAt: problem.createdAt.toISOString(),
          subtask: {
            ...problem.subtask,
            deadline: problem.subtask.deadline?.toISOString() ?? null,
          },
        })),
      }}
      departments={departments}
      // Administrators cannot hold subtasks, so they are never a valid target.
      candidates={users.data
        .filter((user) => user.role !== 'ADMIN')
        .map((user) => ({
          ...user,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          lockedUntil: user.lockedUntil?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        }))}
    />
  );
}
