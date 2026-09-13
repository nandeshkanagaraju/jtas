/**
 * GET /api/dashboard/md — the MD dashboard (build spec M8.1).
 *
 * `?from=YYYY-MM-DD&to=YYYY-MM-DD`, both IST calendar days, defaulting to the
 * current month. Commanders only: the whole payload is a statement about other
 * people's performance.
 */
import { handler, ok } from '@/lib/api/respond';
import { can } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { mdDashboard, parseRange } from '@/lib/services/analytics';
import { forbidden } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  if (!can(session, 'dashboard:md', undefined)) throw forbidden();

  const params = new URL(request.url).searchParams;
  const range = parseRange({ from: params.get('from'), to: params.get('to') });

  return ok(await mdDashboard(range));
});
