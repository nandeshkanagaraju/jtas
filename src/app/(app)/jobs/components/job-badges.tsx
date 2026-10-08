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

/**
 * Three letters per department, so a five-stop route fits one line.
 *
 * Derived rather than stored: the department codes are the full words
 * ("PRODUCTION"), which is right for an export and far too wide for a column.
 * The full names stay on the row for a screen reader and in the title.
 */
const SHORT: Record<string, string> = {
  PLANNING: 'PLN',
  PURCHASE: 'PUR',
  STORE: 'STR',
  PRODUCTION: 'PRD',
  QUALITY: 'QLY',
  DISPATCH: 'DSP',
  ACCOUNTS: 'ACC',
  HR: 'HR',
};

function short(code: string): string {
  return SHORT[code] ?? code.slice(0, 3).toUpperCase();
}

/**
 * The route a job takes through the shop, as department codes.
 *
 * The list column used to print every department's full name on every row,
 * which on a standard CNC job is the same five words repeated down the page —
 * ink spent on something that never varies. Codes fit, and the separator reads
 * as a flow rather than a list.
 */
export function DepartmentChain({
  departments,
}: {
  departments: Array<{ id: string; name: string; code: string }>;
}) {
  if (departments.length === 0) {
    return <span className="text-muted-foreground text-xs">Not planned yet</span>;
  }

  return (
    <p
      className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-xs"
      title={departments.map((department) => department.name).join(' → ')}
    >
      {departments.map((department, index) => (
        <span key={department.id} className="contents">
          {index > 0 ? (
            <span aria-hidden className="text-border">
              ›
            </span>
          ) : null}
          <span className="code uppercase">{short(department.code)}</span>
        </span>
      ))}
      <span className="sr-only">
        {departments.map((department) => department.name).join(', then ')}
      </span>
    </p>
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
        <span className="code text-muted-foreground">{formatIST(date, 'dd MMM, hh:mm a')}</span>
        <span className={TONE_CLASS[label.tone]}>· {label.text}</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      <div className="code text-sm whitespace-nowrap">{formatIST(date)}</div>
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
    <div className="w-28 space-y-1.5">
      <p className="text-muted-foreground text-xs">
        <span className="code text-foreground font-medium">
          {progress.completed}/{progress.total}
        </span>{' '}
        done
      </p>
      <div
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress.completed} of ${progress.total} subtasks completed`}
        className="bg-muted border-border h-1.5 overflow-hidden rounded-full border"
      >
        <div
          className="bg-ok h-full transition-[width] motion-reduce:transition-none"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}
