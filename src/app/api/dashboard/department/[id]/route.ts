/**
 * GET /api/dashboard/department/:id — one department's scorecard, with the
 * same range across all eight for context (build spec M8.2).
 */
import { handler, ok } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { departmentReport, parseRange } from '@/lib/services/analytics';
import { forbidden } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request, context: { params: Promise<{ id: string }> }) => {
  const session = await requireActiveSession();
  if (!can(session, 'dashboard:department', undefined)) throw forbidden();

  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const range = parseRange({ from: params.get('from'), to: params.get('to') });

  return ok(await departmentReport(id, range));
});
