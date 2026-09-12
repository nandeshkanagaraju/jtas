/**
 * GET /api/departments — SDD section 6.2.
 *
 * Readable by any signed-in user: every screen that shows a subtask needs the
 * department label, so restricting it would break the member workspace.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listDepartments } from '@/lib/services/department-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  assertCan(session, 'department:view', undefined);

  const url = new URL(request.url);
  const includeInactive = url.searchParams.get('includeInactive') === 'true';

  return ok({ data: await listDepartments({ includeInactive }) });
});
