import type { JobStatus, Priority } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { deadlineLabel, type DeadlineTone } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

/**
 * Status colours follow SDD section 7.4, where semantic colour is reserved for
 * state so that a red row on the shop floor always means the same thing.
 */
const STATUS_STYLES: Record<JobStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground hover:bg-muted' },
  IN_PROGRESS: {
    label: 'In progress',
    className: 'bg-state-progress text-white hover:bg-state-progress',
  },
  AT_RISK: { label: 'At risk', className: 'bg-state-problem text-white hover:bg-state-problem' },
  DELAYED: { label: 'Delayed', className: 'bg-state-overdue text-white hover:bg-state-overdue' },
  ON_HOLD: { label: 'On hold', className: 'bg-muted text-foreground hover:bg-muted' },
  COMPLETED: {
    label: 'Completed',
    className: 'bg-state-complete text-white hover:bg-state-complete',
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-transparent text-muted-foreground border border-border',
  },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return <Badge className={cn('whitespace-nowrap', className)}>{label}</Badge>;
}

const PRIORITY_STYLES: Record<Priority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'text-muted-foreground' },
  NORMAL: { label: 'Normal', className: 'text-muted-foreground' },
  HIGH: { label: 'High', className: 'text-state-problem border-state-problem/40' },
  URGENT: { label: 'Urgent', className: 'text-state-overdue border-state-overdue/40' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  // Low and Normal are the common case and deliberately quiet — if everything
  // is highlighted, nothing is.
  if (priority === 'LOW' || priority === 'NORMAL') {
    return <span className="text-muted-foreground text-xs">{PRIORITY_STYLES[priority].label}</span>;
  }

  const { label, className } = PRIORITY_STYLES[priority];
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', className)}>
      {label}
    </Badge>
  );
}

const TONE_CLASS: Record<DeadlineTone, string> = {
  overdue: 'text-state-overdue font-medium',
  urgent: 'text-state-problem font-medium',
  soon: 'text-state-progress',
  normal: 'text-muted-foreground',
};

/**
 * The absolute IST time with a relative "due in" label beneath it. Both, because
 * the relative label carries urgency and the absolute one is what people quote
 * to each other.
 */
export function DeadlineCell({
  deadline,
  className,
  compact,
}: {
  deadline: string;
  className?: string;
  /** One line instead of two, for the phone layout where space is the constraint. */
  compact?: boolean;
}) {
  const date = new Date(deadline);
  const label = deadlineLabel(date);

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
        <div
          className="bg-state-complete h-full transition-all"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
