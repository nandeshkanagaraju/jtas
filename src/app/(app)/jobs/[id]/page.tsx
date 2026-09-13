import type { Metadata } from 'next';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getJob } from '@/lib/services/jobs';

import { JobDetail } from './job-detail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireActiveSession();
  const { id } = await params;

  try {
    const job = await getJob(session, id);
    return { title: `${job.jobCode} — ${job.title}` };
  } catch {
    return { title: 'Job' };
  }
}

/**
 * Job detail.
 *
 * `getJob` is already scoped, so a member asking for a job they hold no subtask
 * on gets NOT_FOUND — which Next renders as the 404 page. That is deliberate:
 * confirming a job code exists is itself information.
 */
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveSession();
  const { id } = await params;

  const job = await getJob(session, id);

  return (
    <JobDetail
      currentUserId={session.id}
      job={{
        ...job,
        overallDeadline: job.overallDeadline.toISOString(),
        publishedAt: job.publishedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      }}
      permissions={{
        edit: can(session, 'job:edit', {
          id: job.id,
          createdById: job.createdBy.id,
          participantIds: [],
        }),
        publish: can(session, 'job:publish', {
          id: job.id,
          createdById: job.createdBy.id,
          participantIds: [],
        }),
        hold: can(session, 'job:hold', {
          id: job.id,
          createdById: job.createdBy.id,
          participantIds: [],
        }),
        cancel: can(session, 'job:cancel', {
          id: job.id,
          createdById: job.createdBy.id,
          participantIds: [],
        }),
        viewAudit: can(session, 'audit:view', undefined),
      }}
    />
  );
}
