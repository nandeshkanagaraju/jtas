/**
 * POST /api/notifications/:id/read — SDD section 6.2, owner only.
 *
 * Ownership is part of the `where` clause rather than a check afterwards, so a
 * guessed id simply matches nothing.
 */
import { handler, ok } from '@/lib/api/respond';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { notFound } from '@/lib/errors';
import { markRead } from '@/lib/notifications/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handler(async () => {
    const session = await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR);
    const { id } = await context.params;

    const marked = await markRead(session.id, id);
    if (!marked) throw notFound('Notification');

    return ok({ read: true });
  })(request);
}
