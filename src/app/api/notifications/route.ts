/**
 * GET /api/notifications — the in-app inbox (SDD section 6.2).
 *
 * Scoped to the caller by construction: there is no user parameter, so one
 * person cannot read another's notifications.
 */
import { handler, ok } from '@/lib/api/respond';
import { requireActiveSession } from '@/lib/auth/session';
import { listNotifications } from '@/lib/notifications/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async (request) => {
  const session = await requireActiveSession();
  const url = new URL(request.url);

  return ok(
    await listNotifications(session.id, {
      unreadOnly: url.searchParams.get('unread') === 'true',
      limit: Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100),
    }),
  );
});
