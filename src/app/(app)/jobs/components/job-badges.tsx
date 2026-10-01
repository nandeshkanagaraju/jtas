import type { JobStatus, Priority } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { jobStatusTone, type Tone } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';
import { completionLabel, deadlineLabel, type DeadlineTone } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

/**
 * Status colours follow SDD section 7.4, where semantic colour is reserved for
 * state so that a red row on the shop floor always means the same thing. The
 * tone itself is decided in lib/ui/tone, which the dashboard reads too, so a
 * delayed job is the same red in both places.
 */
const STATUS_LABELS: Record<JobStatus, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In progress',
  AT_RISK: 'At risk',
  DELAYED: 'Delayed',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge variant={jobStatusTone(status)} className="whitespace-nowrap">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<Priority, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  NORMAL: { label: 'Normal', tone: 'neutral' },
  HIGH: { label: 'High', tone: 'risk' },
  URGENT: { label: 'Urgent', tone: 'late' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  // Low and Normal are the common case and deliberately quiet — if everything
  // is highlighted, nothing is.
  if (priority === 'LOW' || priority === 'NORMAL') {
    return <span className="text-muted-foreground text-xs">{PRIORITY_STYLES[priority].label}</span>;
  }

  const { label, tone } = PRIORITY_STYLES[priority];
  return (
    <Badge variant={tone} className="whitespace-nowrap">
      {label}
    </Badge>
  );
}

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: 'text-late font-medium',
  urgent: 'text-risk font-medium',
  soon: 'text-info',
  normal: 'text-muted-foreground',
};

/**
 * The absolute IST time with a relative "due in" label beneath it. Both, because
 * the relative label carries urgency and the absolute one is what people quote
 * to each other.
 */
export function DeadlineCell({
  deadline,
  completedAt,
  className,
  compact,
}: {
  deadline: string;
  /** Set once the work is finished, which changes what the label measures. */
  completedAt?: string | null;
  className?: string;
  /** One line instead of two, for the phone layout where space is the constraint. */
  compact?: boolean;
}) {
  const date = new Date(deadline);
  const label = completedAt ? completionLabel(date, new Date(completedAt)) : deadlineLabel(date);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs', className)}>
        <span className="tabular text-muted-foreground">{formatIST(date, 'dd MMM, hh:mm a')}</span>
        <span className={TONE_CLASS[label.tone]}>· {label.text}</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      <div className="tabular text-sm">{formatIST(date)}</div>
      <div className={cn('text-xs', TONE_CLASS[label.tone])}>{label.text}</div>
    </div>
  );
}

/** Completed / total subtasks with a thin bar. */
export function JobProgress({
  progress,
}: {
  progress: { completed: number; total: number; percent: number };
}) {
  if (progress.total === 0) {
    return <span className="text-muted-foreground text-xs">No subtasks yet</span>;
  }

  return (
    <div className="w-28 space-y-1">
      <div className="text-muted-foreground tabular text-xs">
        {progress.completed}/{progress.total} done
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className="bg-ok h-full transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
