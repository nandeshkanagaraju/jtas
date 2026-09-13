/**
 * GET /api/problems — the MD's inbox (SDD section 6.2, FR-41).
 *
 * MD and Deputy only. A member follows their own problem from the task screen;
 * the inbox is the decision queue and belongs to whoever makes decisions.
 */
import { handler, ok, parseQuery } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { listProblems } from '@/lib/services/problems';
import { listProblemsQuerySchema } from '@/lib/validation/problem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession(['MD', 'DEPUTY_MD']);
  assertCan(session, 'dashboard:md', undefined);

  const query = parseQuery(new URL(request.url), listProblemsQuerySchema);

  return ok(await listProblems(query));
});
