import type { Metadata } from 'next';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getJob, listContactCandidates } from '@/lib/services/jobs';
import { canManageBilling } from '@/lib/services/billing-service';
import { jobMaterialTotals } from '@/lib/services/material-service';
import { listUsers } from '@/lib/services/users';

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
  const jobRef = { id: job.id, createdById: job.createdBy.id, participantIds: [] };
  const canEdit = can(session, 'job:edit', jobRef);
  // Role-only decisions; the subtask fields are not consulted.
  const anySubtask = { id: '', jobId: job.id, assigneeId: '', departmentId: '' };

  const [materials, canBill, candidates, contacts] = await Promise.all([
    jobMaterialTotals(job.id),
    canManageBilling(session),
    // Reassignment candidates, loaded here so the drawer does not need the
    // Users API, which a job manager (or the deputy) may not call.
    canEdit
      ? listUsers({ page: 1, pageSize: 100, status: 'active', sort: 'name', direction: 'asc' })
      : null,
    canEdit ? listContactCandidates() : [],
  ]);

  return (
    <JobDetail
      currentUserId={session.id}
      materials={materials}
      contacts={contacts}
      canBill={canBill && job.status !== 'DRAFT'}
      candidates={(candidates?.data ?? [])
        .filter((user) => user.role !== 'ADMIN')
        .map((user) => ({
          ...user,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          lockedUntil: user.lockedUntil?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
        }))}
      job={{
        ...job,
        overallDeadline: job.overallDeadline.toISOString(),
        publishedAt: job.publishedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      }}
      permissions={{
        edit: canEdit,
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
        approve: can(session, 'subtask:approve', anySubtask),
        delete: can(session, 'job:delete', jobRef),
        resolveProblems: can(session, 'problem:resolve', {
          id: '',
          raisedById: '',
          subtask: anySubtask,
        }),
      }}
    />
  );
}
