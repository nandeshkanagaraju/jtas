import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';

import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { auditFacets, jobAuditTrail, listAudit } from '@/lib/services/audit-query';
import { prisma } from '@/lib/db/prisma';

import { PageHeader } from '@/components/shared/page-header';

import { AuditViewer } from './audit-viewer';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

/**
 * The audit viewer (build spec M9.4).
 *
 * MD and ADMIN — SDD 6.3's matrix grants "View audit log" to those two and not
 * to the deputy. Read only: nothing on this screen, or behind it, can change a
 * row. Improvement I-12 is "full audit log, no hard deletes — accountability is
 * the product; it must be provable".
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireActiveSession();
  if (!can(session, 'audit:view', undefined)) forbidden();

  const params = await searchParams;

  /*
   * `?job=<id>` traces one job end to end: its own rows plus every subtask and
   * problem under it. Filtering by entity id alone would show three JOB rows
   * and answer a different question — the work happened on the subtasks.
   */
  if (params.job) {
    const [job, trail] = await Promise.all([
      prisma.job.findUnique({
        where: { id: params.job },
        select: { jobCode: true, title: true, status: true },
      }),
      jobAuditTrail(params.job),
    ]);

    return <JobTrace jobId={params.job} job={job} trail={trail} />;
  }

  const filters = {
    actorId: params.actorId ?? '',
    entityType: params.entityType ?? '',
    entityId: params.entityId ?? '',
    action: params.action ?? '',
    from: params.from ?? '',
    to: params.to ?? '',
  };

  const [page, facets] = await Promise.all([
    listAudit({
      actorId: filters.actorId || undefined,
      entityType: filters.entityType || undefined,
      entityId: filters.entityId || undefined,
      action: filters.action || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    auditFacets(),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Append-only record"
        title="Audit log"
        lead="Every state-changing action, with who did it and what changed. Nothing here can be edited or removed, which is what makes it evidence."
      />

      <AuditViewer initial={page} facets={facets} filters={filters} />
    </div>
  );
}

function JobTrace({
  jobId,
  job,
  trail,
}: {
  jobId: string;
  job: { jobCode: string; title: string; status: string } | null;
  trail: Awaited<ReturnType<typeof jobAuditTrail>>;
}) {
  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/audit', label: 'The whole log' }}
        eyebrow={job ? job.jobCode : 'Job trace'}
        title={job ? `${job.title} — full trace` : 'Job trace'}
        lead={
          job
            ? `${trail.length} recorded actions on this job and everything under it, oldest first.`
            : 'That job does not exist.'
        }
      />

      <AuditViewer
        initial={{ data: trail, nextCursor: null, total: trail.length }}
        facets={{ actions: [], entityTypes: [], actors: [] }}
        filters={{ entityId: jobId }}
        traceMode
      />
    </div>
  );
}
