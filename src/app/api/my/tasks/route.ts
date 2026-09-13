/**
 * GET /api/my/tasks — SDD section 6.2, FR-30.
 *
 * The member's whole working set, pre-grouped, in one query. Every role can
 * call it: an MD or deputy who holds subtasks has a working set too.
 */
import { handler, ok } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { getMyTasks } from '@/lib/services/my-tasks-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await requireActiveSession();

  // Scoped to the caller by construction — there is no user parameter, so one
  // member cannot ask for another's list.
  return ok(await getMyTasks(session.id));
});
