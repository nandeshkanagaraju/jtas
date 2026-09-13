import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';
import { listJobTemplates } from '@/lib/services/job-template-service';
import { getJob } from '@/lib/services/jobs';
import { listUsers } from '@/lib/services/users';
import { formatIST } from '@/lib/utils/time';

import { PlanWizard } from './plan-wizard';

export const metadata: Metadata = { title: 'Plan subtasks' };
export const dynamic = 'force-dynamic';

/**
 * Steps 2 and 3 of the job wizard: build the subtask chain, review it, publish.
 *
 * Lives under the job rather than under `/jobs/new` because step 1 has already
 * created the draft — a half-finished job survives a closed tab, and this URL
 * is where the MD returns to finish it.
 */
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  if (!can(session, 'job:create', undefined)) forbidden();

  const { id } = await params;
  const job = await getJob(session, id);

  // Only a draft is planned; a published job's subtasks are edited from its
  // timeline instead.
  if (job.status !== 'DRAFT') notFound();

  const [departments, templates, users] = await Promise.all([
    listDepartments(),
    listJobTemplates(),
    listUsers({
      page: 1,
      pageSize: 100,
      status: 'active',
      sort: 'name',
      direction: 'asc',
    }),
  ]);

  return (
    <PlanWizard
      job={{
        id: job.id,
        jobCode: job.jobCode,
        title: job.title,
        // The wizard compares deadlines as IST wall-clock strings, so the job's
        // own deadline crosses in the same form.
        overallDeadline: formatIST(job.overallDeadline, "yyyy-MM-dd'T'HH:mm"),
      }}
      departments={departments}
      templates={templates}
      users={users.data.map((user) => ({
        ...user,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
      }))}
    />
  );
}
