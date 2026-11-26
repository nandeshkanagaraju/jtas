/**
 * POST /api/notifications/read-all — clears the caller's unread count.
 */
import { handler, ok } from '@/lib/api/respond';
import { ALL_ROLES_WITH_SUPERVISOR, requireActiveSession } from '@/lib/auth/session';
import { markAllRead } from '@/lib/notifications/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  const session = await requireActiveSession(ALL_ROLES_WITH_SUPERVISOR);
  return ok({ read: await markAllRead(session.id) });
});
