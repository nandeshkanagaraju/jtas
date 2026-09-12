/**
 * POST /api/users/:id/reactivate.
 *
 * Not in the SDD endpoint table, but required by it: FR-70 forbids hard
 * deletes, so without a way back a mistaken deactivation would be unrecoverable
 * through the UI and would need a database edit.
 */
import { handler, ok } from '@/lib/api/respond';
import { assertCan } from '@/lib/auth/policy';
import { requireActiveSession } from '@/lib/auth/session';
import { getUser, reactivateUser } from '@/lib/services/users';
import { clientIp } from '@/lib/utils/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async (req) => {
    const session = await requireActiveSession(['MD', 'ADMIN']);
    const { id } = await context.params;

    const existing = await getUser(id);
    assertCan(session, 'user:manage', { id: existing.id, role: existing.role });

    const user = await reactivateUser(id, { id: session.id }, { ipAddress: clientIp(req) });

    return ok({ user });
  })(request);
}
