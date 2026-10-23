'use client';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  History,
  MessageSquare,
  Paperclip,
  UserRound,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/provider';
import { openAttachment } from '@/components/collaboration/attachment-panel';
import { toast } from '@/lib/i18n/toast';
import type { ActivityItem } from '@/lib/services/activity-feed';
import { formatIST } from '@/lib/utils/time';
import { STATUS_LABELS } from './progress-map';

const ACTIONS: Record<string, string> = {
  JOB_CREATED: 'Created the job',
  JOB_UPDATED: 'Updated the job',
  JOB_PUBLISHED: 'Published the job',
  JOB_HELD: 'Put the job on hold',
  JOB_UNHELD: 'Resumed the job',
  JOB_CANCELLED: 'Cancelled the job',
  SUBTASK_CREATED: 'Added a department task',
  SUBTASK_UPDATED: 'Updated a department task',
  SUBTASK_STATUS_CHANGED: 'Changed task status',
  SUBTASK_DEADLINE_CHANGED: 'Changed the deadline',
  SUBTASK_REASSIGNED: 'Reassigned the task',
  SUBTASK_BLOCKED: 'Task blocked',
  SUBTASK_UNBLOCKED: 'Handoff ready',
  SUBTASK_COMMITMENT_MISSED: 'Deadline commitment missed',
  SUBTASK_OVERDUE_ESCALATED: 'Overdue reminder',
  COMMENT_ADDED: 'Posted a message',
  ATTACHMENT_UPLOADED: 'Shared a file',
  ATTACHMENT_DELETED: 'Removed a file',
  PROBLEM_RAISED: 'Reported a problem',
  PROBLEM_ACKNOWLEDGED: 'Acknowledged a problem',
  PROBLEM_RESOLVED: 'Resolved a problem',
  PROBLEM_REJECTED: 'Closed a problem',
  EXTENSION_REQUESTED: 'Requested more time',
  EXTENSION_APPROVED: 'Approved more time',
  EXTENSION_REJECTED: 'Declined more time',
};
const ICONS = {
  comment: MessageSquare,
  status: CheckCircle2,
  deadline: CalendarClock,
  problem: AlertTriangle,
  attachment: Paperclip,
  assignment: UserRound,
  job: History,
  other: History,
};
const FIELDS: Record<string, string> = {
  status: 'Status',
  deadline: 'Deadline',
  overallDeadline: 'Job deadline',
  requestedDeadline: 'Requested deadline',
  reason: 'Reason',
  completionNote: 'Completion note',
  mdActionNote: 'Decision note',
};
export function UpdateTimeline({ items }: { items: ActivityItem[] }) {
  const { t } = useLanguage();
  function value(field: string, text: string) {
    if (text === 'none' || text === '—') return '—';
    if (field === 'status') return t(STATUS_LABELS[text] ?? text);
    if (
      field.toLowerCase().includes('deadline') &&
      /^\d{4}-\d\d-\d\dT/.test(text) &&
      !Number.isNaN(Date.parse(text))
    )
      return formatIST(new Date(text));
    return text;
  }
  if (!items.length)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t('No updates in this view yet.')}
      </p>
    );
  return (
    <ol className="live-update-timeline" aria-label={t('Job update timeline')}>
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <li key={item.id} className="live-update-entry" data-kind={item.kind}>
            <span className="live-update-icon">
              <Icon className="size-4" aria-hidden />
            </span>
            <article className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm font-semibold">{item.actor?.name ?? t('System')}</p>
                <time className="text-muted-foreground text-xs" dateTime={item.at}>
                  {formatIST(new Date(item.at), 'dd MMM, HH:mm')}
                </time>
              </div>
              <p className="text-muted-foreground text-xs">
                {t(ACTIONS[item.action] ?? 'Posted an update')}
                {item.subtask ? ` · ${item.subtask.department}` : ''}
              </p>
              {item.subtask ? <p className="text-xs">{item.subtask.title}</p> : null}
              {item.body ? (
                item.kind === 'attachment' && item.attachmentId ? (
                  <button
                    type="button"
                    className="text-action min-h-11 max-w-full text-left text-sm break-all underline"
                    onClick={() =>
                      void openAttachment(item.attachmentId!).catch(() =>
                        toast.error('Could not open that file.'),
                      )
                    }
                  >
                    {item.body}
                  </button>
                ) : (
                  <p
                    className={
                      item.kind === 'comment'
                        ? 'live-message-body'
                        : 'text-sm break-words whitespace-pre-wrap'
                    }
                  >
                    {item.body}
                  </p>
                )
              ) : null}
              {item.changes.map((change, index) => (
                <p
                  key={index}
                  className="text-muted-foreground text-xs break-words whitespace-pre-wrap"
                >
                  <span className="font-medium">{t(FIELDS[change.field] ?? change.field)}: </span>
                  {['reason', 'completionNote', 'mdActionNote'].includes(change.field) ? (
                    change.after
                  ) : (
                    <>
                      {value(change.field, change.before)} → {value(change.field, change.after)}
                    </>
                  )}
                </p>
              ))}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
