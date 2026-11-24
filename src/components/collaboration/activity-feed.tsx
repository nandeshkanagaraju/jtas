'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  History,
  MessageSquare,
  Paperclip,
  UserCog,
} from 'lucide-react';

import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';

import { openAttachment } from '@/components/collaboration/attachment-panel';
import { CommentBody } from '@/components/collaboration/comment-body';
import { apiFetch } from '@/lib/api/client';
import { useLanguage } from '@/lib/i18n/provider';
import { toast } from '@/lib/i18n/toast';
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
  comment: 'text-info',
  status: 'text-ok',
  deadline: 'text-risk',
  problem: 'text-late',
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

/** Fields a reader cares about, with their plain names. Ids, raw actions and
 * bookkeeping timestamps stay in the forensic view. */
const FIELDS: Record<string, string> = {
  status: 'Status',
  deadline: 'Deadline',
  overallDeadline: 'Job deadline',
  requestedDeadline: 'Requested deadline',
  priority: 'Priority',
  note: 'Note',
  reason: 'Reason',
  completionNote: 'Completion note',
  mdActionNote: 'Decision note',
};

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING: 'Ready to start',
  BLOCKED: 'Waiting',
  IN_PROGRESS: 'In progress',
  PROBLEM: 'Problem',
  AWAITING_APPROVAL: 'Awaiting approval',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
  AT_RISK: 'At risk',
  DELAYED: 'Delayed',
};

const TEXT_FIELDS = new Set(['note', 'reason', 'completionNote', 'mdActionNote']);
const EMPTY = new Set(['', 'none', '—', 'null']);

/** Readable change lines; drops ids, system codes and empty notes. */
function readableChanges(
  changes: ActivityItem['changes'],
): Array<{ label: string; text?: string; before?: string; after?: string }> {
  const lines: Array<{ label: string; text?: string; before?: string; after?: string }> = [];
  for (const change of changes) {
    const label = FIELDS[change.field];
    if (!label) continue;
    if (TEXT_FIELDS.has(change.field)) {
      const text = change.after?.trim() ?? '';
      // A system reason such as JOB_PUBLISHED is not a sentence anyone wrote.
      if (EMPTY.has(text) || /^[A-Z_]+$/.test(text)) continue;
      lines.push({ label, text });
      continue;
    }
    lines.push({ label, before: change.before, after: change.after });
  }
  return lines;
}

function readableValue(field: string, text: string): string {
  if (EMPTY.has(text)) return '—';
  if (field === 'status') return STATUS_WORDS[text] ?? text;
  if (/^\d{4}-\d\d-\d\dT/.test(text) && !Number.isNaN(Date.parse(text))) {
    return formatIST(new Date(text));
  }
  return text;
}

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
  const { t } = useLanguage();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);

    apiFetch<{ data: ActivityItem[] }>(`/api/jobs/${jobId}/activity?limit=60`)
      .then((result) => live && setItems(result.data))
      .catch(() => live && setFailed(true));

    return () => {
      live = false;
    };
  }, [jobId, attempt]);

  if (failed) {
    return (
      <ErrorState
        title="Could not load the activity"
        message="The job itself is fine — only its history failed to arrive."
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  if (items === null) {
    return <ListSkeleton rows={3} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nothing has happened yet"
        description="Comments, status changes, deadline changes and files will appear here as the job moves."
      />
    );
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
                  'bg-card flex size-7 shrink-0 items-center justify-center rounded-full border',
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
                <span className="code text-muted-foreground text-xs">
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
                  <div className="bg-muted/50 min-w-0 flex-1 rounded-md border px-2.5 py-1.5">
                    <CommentBody
                      body={item.body}
                      mentions={mentionCandidates}
                      currentUserId={currentUserId}
                    />
                  </div>
                </div>
              ) : null}

              {item.kind === 'problem' && item.body ? (
                <p className="border-late-edge mt-1 border-l-2 pl-2.5 text-sm">{item.body}</p>
              ) : null}

              {item.kind === 'attachment' && item.body ? (
                item.attachmentId ? (
                  <button
                    type="button"
                    className="text-action mt-0.5 text-left text-sm underline underline-offset-2"
                    onClick={() => {
                      openAttachment(item.attachmentId!).catch(() =>
                        toast.error('Could not open that file.'),
                      );
                    }}
                  >
                    {item.body}
                  </button>
                ) : (
                  <p className="mt-0.5 text-sm">{item.body}</p>
                )
              ) : null}

              {/*
               * Field changes, for the events where they are the news. A
               * comment's body and an attachment's file name are already shown
               * above, and repeating them as `fileName — → drawing.pdf` is
               * noise that makes the readable line harder to find.
               */}
              {SHOW_CHANGES.has(item.kind)
                ? readableChanges(item.changes)
                    .slice(0, 3)
                    .map((line) => (
                      <p
                        key={line.label}
                        className="text-muted-foreground mt-0.5 text-xs break-words"
                      >
                        <span className="font-medium">{t(line.label)}: </span>
                        {line.text !== undefined
                          ? line.text
                          : `${t(readableValue(line.label === 'Status' ? 'status' : 'value', line.before ?? ''))} → ${t(readableValue(line.label === 'Status' ? 'status' : 'value', line.after ?? ''))}`}
                      </p>
                    ))
                : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
