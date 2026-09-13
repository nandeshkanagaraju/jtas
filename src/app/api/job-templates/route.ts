/**
 * GET /api/job-templates — the chains the job wizard can prefill from (FR-11).
 *
 * MD and Deputy only: templates exist to create jobs, which is their capability.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listJobTemplates } from '@/lib/services/job-template-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
  assertCan(session, 'job:create', undefined);

  return ok({ data: await listJobTemplates() });
});
