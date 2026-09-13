import type { Metadata } from 'next';

import { requireActiveSession } from '@/lib/auth/session';
import { listNotifications } from '@/lib/notifications/notification-service';

import { NotificationsScreen } from './notifications-screen';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

/**
 * The in-app inbox (SDD section 7.1).
 *
 * A backup for the email, not a replacement: PDD section 12 lists "mail lands
 * in spam and nobody sees it" as a risk, and this is the mitigation. Everything
 * here was also sent.
 */
export default async function NotificationsPage() {
  const session = await requireActiveSession();
  const inbox = await listNotifications(session.id, { limit: 50 });

  return (
    <NotificationsScreen
      initial={{
        unreadCount: inbox.unreadCount,
        data: inbox.data.map((item) => ({
          ...item,
          readAt: item.readAt?.toISOString() ?? null,
          sentAt: item.sentAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
      }}
    />
  );
}
