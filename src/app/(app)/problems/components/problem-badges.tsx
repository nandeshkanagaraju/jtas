import type { ProblemSeverity, ProblemStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { severityTone, type Tone } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';
import { formatElapsed } from '@/lib/utils/duration';

/**
 * Severity colour, loudest first.
 *
 * A blocker halts a job, so it gets the overdue red; high gets amber; medium
 * and low stay quiet. If everything is highlighted then nothing is, and the
 * inbox stops being a queue.
 */
export function SeverityBadge({ severity }: { severity: ProblemSeverity }) {
  return (
    <Badge variant={severityTone(severity)} className="whitespace-nowrap">
      {severity.charAt(0) + severity.slice(1).toLowerCase()}
    </Badge>
  );
}

const STATUS_STYLES: Record<ProblemStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'neutral' },
  ACKNOWLEDGED: { label: 'Seen', tone: 'info' },
  RESOLVED: { label: 'Resolved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
};

export function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  const { label, tone } = STATUS_STYLES[status];
  return (
    <Badge variant={tone} className="whitespace-nowrap">
      {label}
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
  const label = formatElapsed(ageHours * 60);

  return (
    <span
      className={cn(
        'tabular text-sm',
        isStale ? 'text-late font-semibold' : 'text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}
