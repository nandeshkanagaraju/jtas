'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  UserCog,
} from 'lucide-react';

import { CommentBody } from '@/components/collaboration/comment-body';
import { apiFetch } from '@/lib/api/client';
import type { ActivityItem } from '@/lib/services/activity-feed';
import type { MentionCandidate } from '@/lib/domain/mentions';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

const ICONS: Record<ActivityItem['kind'], typeof History> = {
  comment: MessageSquare,
  status: CheckCircle2,
  deadline: CalendarClock,
  problem: AlertTriangle,
  attachment: Paperclip,
  assignment: UserCog,
  job: History,
  other: History,
};

const TONES: Record<ActivityItem['kind'], string> = {
  comment: 'text-state-progress',
  status: 'text-state-complete',
  deadline: 'text-state-problem',
  problem: 'text-state-overdue',
  attachment: 'text-muted-foreground',
  assignment: 'text-muted-foreground',
  job: 'text-muted-foreground',
  other: 'text-muted-foreground',
};

/** Kinds whose field-level diff is worth showing under the line. */
const SHOW_CHANGES = new Set<ActivityItem['kind']>([
  'status',
  'deadline',
  'assignment',
  'job',
  'other',
]);

/** "SUBTASK_STATUS_CHANGED" -> "status changed". */
function phrase(action: string): string {
  return action
    .replace(/^(SUBTASK|JOB|PROBLEM|ATTACHMENT|COMMENT|EXTENSION)_/, '')
    .replaceAll('_', ' ')
    .toLowerCase();
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The job's story in one column (build spec M10.3).
 *
 * Comments, status changes, deadline changes, problems and attachments, merged
 * and newest first. Built from the audit log, so it cannot disagree with the
 * record — and a comment shows its text, because "Ravi commented" without the
 * comment is the least useful line a feed can carry.
 */
export function ActivityFeed({
  jobId,
  currentUserId,
  mentionCandidates = [],
}: {
  jobId: string;
  currentUserId: string;
  mentionCandidates?: MentionCandidate[];
}) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    apiFetch<{ data: ActivityItem[] }>(`/api/jobs/${jobId}/activity?limit=60`)
      .then((result) => live && setItems(result.data))
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
    };
  }, [jobId]);

  if (failed) {
    return <p className="text-muted-foreground text-sm">Could not load the activity.</p>;
  }

  if (items === null) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-3.5 animate-spin" />
        Loading…
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing has happened on this job yet.</p>;
  }

  return (
    <ol className="space-y-0">
      {items.map((item, index) => {
        const Icon = ICONS[item.kind];
        const last = index === items.length - 1;

        return (
          <li key={item.id} className="flex gap-3">
            {/* The rail: an icon per event, joined by a line so the column
                reads as one sequence rather than a stack of cards. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'bg-background flex size-7 shrink-0 items-center justify-center rounded-full border',
                  TONES[item.kind],
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {!last ? <span className="bg-border w-px flex-1" /> : null}
            </div>

            <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{item.actor?.name ?? 'System'}</span>
                <span className="text-muted-foreground text-sm">{phrase(item.action)}</span>
                <span className="text-muted-foreground tabular text-xs">
                  {formatIST(new Date(item.at))}
                </span>
              </p>

              {item.subtask ? (
                <p className="text-muted-foreground truncate text-xs">
                  {item.subtask.department} · {item.subtask.title}
                </p>
              ) : null}

              {item.kind === 'comment' && item.body ? (
                <div className="mt-1.5 flex gap-2">
                  <span
                    className="bg-muted mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                    aria-hidden
                  >
                    {initials(item.actor?.name ?? '?')}
                  </span>
                  <div className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5">
                    <CommentBody
                      body={item.body}
                      mentions={mentionCandidates}
                      currentUserId={currentUserId}
                    />
                  </div>
                </div>
              ) : null}

              {item.kind === 'problem' && item.body ? (
                <p className="border-state-overdue/40 mt-1 border-l-2 pl-2.5 text-sm">
                  {item.body}
                </p>
              ) : null}

              {item.kind === 'attachment' && item.body ? (
                <p className="mt-0.5 text-sm">{item.body}</p>
              ) : null}

              {/*
               * Field changes, for the events where they are the news. A
               * comment's body and an attachment's file name are already shown
               * above, and repeating them as `fileName — → drawing.pdf` is
               * noise that makes the readable line harder to find.
               */}
              {SHOW_CHANGES.has(item.kind) && item.changes.length > 0 ? (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {item.changes
                    .slice(0, 3)
                    .map((change) => `${change.field} ${change.before} → ${change.after}`)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
