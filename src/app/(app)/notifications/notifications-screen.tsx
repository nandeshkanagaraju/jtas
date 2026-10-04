'use client';

import { BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { apiFetch, apiPost } from '@/lib/api/client';
import { inboxLinkFor } from '@/lib/notifications/inbox-links';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

interface NotificationDto {
  id: string;
  type: string;
  subject: string;
  body: string;
  entityType: string;
  entityId: string;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
  suppressedReason: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  SUBTASK_ASSIGNED: 'New task',
  SUBTASK_REASSIGNED: 'Reassigned',
  DEADLINE_REMINDER: 'Due soon',
  OVERDUE_MEMBER: 'Overdue',
  OVERDUE_MD: 'Overdue',
  PROBLEM_RAISED: 'Problem',
  PROBLEM_RESOLVED: 'Problem resolved',
  DEADLINE_CHANGED: 'Deadline changed',
  EXTENSION_REQUESTED: 'More time asked',
  APPROVAL_REQUIRED: 'Needs approval',
  READY_TO_START: 'Ready to start',
  JOB_COMPLETED: 'Job complete',
  DAILY_DIGEST_MD: 'Daily summary',
};

export function NotificationsScreen({
  initial,
}: {
  initial: { data: NotificationDto[]; unreadCount: number };
}) {
  const router = useRouter();
  const [inbox, setInbox] = useState(initial);
  const [busy, setBusy] = useState(false);
  const withheld = inbox.data.filter((item) => item.suppressedReason).length;

  function markOne(id: string) {
    // Optimistic: the row is read the moment it is opened, and a failed call
    // only means the badge is briefly wrong.
    setInbox((current) => ({
      unreadCount: Math.max(0, current.unreadCount - 1),
      data: current.data.map((item) =>
        item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    }));

    /*
     * `keepalive` because this fires on the same click that navigates away.
     * A plain fetch is cancelled the moment the router tears the page down, so
     * every notification stayed unread unless the reader also pressed "Mark all
     * read" — the badge became a number nobody could clear by doing the obvious
     * thing. Not awaited, for the same reason.
     */
    void fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => undefined);
  }

  async function markAll() {
    setBusy(true);
    try {
      await apiPost('/api/notifications/read-all', {});
      setInbox(await apiFetch('/api/notifications?limit=50'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground text-sm">
            {withheld > 0
              ? `${withheld} ${withheld === 1 ? 'email was' : 'emails were'} withheld. The reason is on the row.`
              : inbox.unreadCount === 0
                ? 'Nothing unread.'
                : `${inbox.unreadCount} unread.`}
          </p>
        </div>

        {inbox.unreadCount > 0 ? (
          <Button variant="outline" size="sm" onClick={markAll} disabled={busy}>
            <CheckCheck className="size-4" />
            Mark all read
          </Button>
        ) : null}
      </div>

      {inbox.data.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-2 rounded-lg border py-16 text-center">
          <BellOff className="text-muted-foreground size-8" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Assignments, reminders and decisions will appear here as well as in your email.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {inbox.data.map((item) => (
            <li key={item.id}>
              <Link
                href={inboxLinkFor(item)}
                onClick={() => !item.readAt && markOne(item.id)}
                className={cn(
                  'hover:bg-accent/40 block rounded-lg border p-4 transition-colors',
                  !item.readAt && 'border-state-progress/40 bg-state-progress/5',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {TYPE_LABELS[item.type] ?? item.type}
                  </span>
                  <span className="text-muted-foreground tabular text-xs">
                    · {formatIST(new Date(item.sentAt ?? item.createdAt))}
                  </span>
                  {!item.readAt ? (
                    <span className="bg-state-progress size-1.5 rounded-full" aria-label="Unread" />
                  ) : null}
                </div>
                <p className="mt-1 font-medium">{item.subject}</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm whitespace-pre-wrap">
                  {item.body}
                </p>
                {item.suppressedReason ? (
                  <p className="text-state-overdue mt-2 text-sm">{item.suppressedReason}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
