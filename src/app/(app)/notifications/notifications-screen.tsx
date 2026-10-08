'use client';

import { BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
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
  COMMITMENT_OPEN: 'Commit a date',
  COMMITMENT_REMINDER: 'Commit a date',
  COMMITMENT_MISSED_MEMBER: 'Commitment missed',
  COMMITMENT_MISSED_MD: 'Commitment missed',
  COMMITMENT_MADE: 'Date committed',
  PREDECESSOR_DATE_CHANGED: 'Upstream date moved',
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
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Your inbox"
        title="Notifications"
        lead={lead(inbox.unreadCount, withheld)}
        actions={
          inbox.unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={markAll} disabled={busy}>
              <CheckCheck className="size-4" />
              Mark all read
            </Button>
          ) : null
        }
      />

      {inbox.data.length === 0 ? (
        <Panel flush>
          <EmptyState
            icon={BellOff}
            title="No notifications yet"
            description="Assignments, reminders and decisions will appear here as well as in your email."
          />
        </Panel>
      ) : (
        <Panel flush>
          <ul className="divide-border divide-y">
            {inbox.data.map((item) => (
              <li key={item.id}>
                <Link
                  href={inboxLinkFor(item)}
                  onClick={() => !item.readAt && markOne(item.id)}
                  className={cn(
                    'hover:bg-accent/40 block px-4 py-3.5 transition-colors',
                    // Unread carries a rule on the leading edge rather than a
                    // tinted row: a page of tinted rows stops reading as "these
                    // are the new ones" the moment most of them are.
                    !item.readAt && 'border-l-info border-l-[3px] pl-[13px]',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        'text-xs',
                        item.readAt ? 'text-muted-foreground' : 'text-info font-medium',
                      )}
                    >
                      {TYPE_LABELS[item.type] ?? item.type}
                    </span>
                    <span className="code text-muted-foreground text-xs">
                      · {formatIST(new Date(item.sentAt ?? item.createdAt))}
                    </span>
                    {!item.readAt ? (
                      <span className="text-info text-xs font-medium">· Unread</span>
                    ) : null}
                  </div>
                  <p className={cn('mt-1', item.readAt ? 'font-medium' : 'font-semibold')}>
                    {item.subject}
                  </p>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm whitespace-pre-wrap">
                    {item.body}
                  </p>
                  {item.suppressedReason ? (
                    <p className="text-late border-late-edge bg-late-soft mt-2 rounded-md border px-2.5 py-1.5 text-xs">
                      Not emailed — {item.suppressedReason}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** One sentence of state: unread first, withheld mail if any. */
function lead(unread: number, withheld: number): string {
  const parts: string[] = [];
  parts.push(unread === 0 ? 'Nothing unread' : `${unread} unread`);
  if (withheld > 0) {
    parts.push(
      `${withheld} ${withheld === 1 ? 'email was' : 'emails were'} withheld — the reason is on the row`,
    );
  }
  return `${parts.join(', ')}. Email is still the delivery; this is the record.`;
}
