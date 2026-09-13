import type { ProblemSeverity, ProblemStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Severity colour, loudest first.
 *
 * A blocker halts a job, so it gets the overdue red; high gets amber; medium
 * and low stay quiet. If everything is highlighted then nothing is, and the
 * inbox stops being a queue.
 */
const SEVERITY_STYLES: Record<ProblemSeverity, string> = {
  BLOCKER: 'bg-state-overdue text-white hover:bg-state-overdue',
  HIGH: 'bg-state-problem text-white hover:bg-state-problem',
  MEDIUM: 'bg-muted text-foreground hover:bg-muted',
  LOW: 'bg-transparent text-muted-foreground border border-border',
};

export function SeverityBadge({ severity }: { severity: ProblemSeverity }) {
  return (
    <Badge className={cn('whitespace-nowrap', SEVERITY_STYLES[severity])}>
      {severity.charAt(0) + severity.slice(1).toLowerCase()}
    </Badge>
  );
}

const STATUS_LABELS: Record<ProblemStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Seen',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

export function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  return (
    <Badge variant="outline" className="whitespace-nowrap">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * Age, in red once past a day.
 *
 * PDD section 12: "problems older than 24 h flagged red on the dashboard" — the
 * mitigation for the inbox becoming a graveyard.
 */
export function ProblemAge({ ageHours, isStale }: { ageHours: number; isStale: boolean }) {
  const label =
    ageHours < 1
      ? `${Math.max(1, Math.round(ageHours * 60))} min`
      : ageHours < 48
        ? `${Math.round(ageHours)} h`
        : `${Math.round(ageHours / 24)} days`;

  return (
    <span
      className={cn(
        'tabular text-sm',
        isStale ? 'text-state-overdue font-semibold' : 'text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}
