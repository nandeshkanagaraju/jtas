'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/** How often the bell re-checks. Slow on purpose — see below. */
const POLL_MS = 60_000;

/**
 * The unread-notification bell.
 *
 * Polls once a minute rather than holding a socket open: at fifteen concurrent
 * users a poll is cheaper than the connection it would replace, and the thing
 * that actually reaches somebody is the email — this is a convenience, not the
 * delivery mechanism.
 *
 * Seeded from the server so the first paint already carries the right number.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const result = await apiFetch<{ unreadCount: number }>('/api/notifications?limit=1');
        if (!cancelled) setUnread(result.unreadCount);
      } catch {
        // A failed poll keeps the last known count; the next one corrects it.
      }
    };

    const timer = window.setInterval(check, POLL_MS);
    // Also check when the tab comes back, which is when a count is most stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className={cn(
        'relative flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors',
        'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <Bell className="size-4" />
      {unread > 0 ? (
        <Badge
          className="bg-state-progress absolute top-1 right-0 h-4 min-w-4 justify-center px-1 text-[10px] text-white tabular-nums"
          aria-hidden
        >
          {unread > 99 ? '99+' : unread}
        </Badge>
      ) : null}
    </Link>
  );
}
