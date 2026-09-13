/**
 * GET /api/audit — build spec M9.4.
 *
 * MD and ADMIN. Read only: there is no POST, PUT or DELETE here or anywhere
 * else against `AuditLog`. Improvement I-12 is "full audit log, no hard
 * deletes — accountability is the product; it must be provable", and a log with
 * an edit path proves nothing.
 */
import { handler, ok } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { forbidden } from '@/lib/errors';
import { auditFacets, listAudit } from '@/lib/services/audit-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'audit:view', undefined)) throw forbidden();

  const params = new URL(request.url).searchParams;

  const [page, facets] = await Promise.all([
    listAudit(
      {
        actorId: params.get('actorId') ?? undefined,
        entityType: params.get('entityType') ?? undefined,
        entityId: params.get('entityId') ?? undefined,
        action: params.get('action') ?? undefined,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      },
      { cursor: params.get('cursor') ?? undefined },
    ),
    params.get('facets') === 'false' ? Promise.resolve(null) : auditFacets(),
  ]);

  return ok({ ...page, facets });
});
