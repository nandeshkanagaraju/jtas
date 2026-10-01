import Link from 'next/link';
import { ArrowRight, CheckCircle2, Clock, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatElapsed } from '@/lib/utils/duration';
import { severityTone } from '@/lib/ui/tone';
import type { AttentionProblem, AttentionSubtask } from '@/lib/services/analytics';

/**
 * Start here.
 *
 * One item, with the decision attached to it. The MD opens this page to find
 * out what to do first; everything below is the queue behind that answer, so
 * this block gets the only strong surface on the screen and the only filled
 * button.
 *
 * Priority is: an open problem (someone is stopped and waiting on a decision)
 * before a slipped deadline (late, but still moving). With neither, it says so
 * plainly rather than disappearing — an empty page is harder to trust than one
 * that states it is clear.
 */
export function PriorityCallout({
  problem,
  late,
}: {
  problem: AttentionProblem | undefined;
  late: AttentionSubtask | undefined;
}) {
  if (problem) {
    return (
      <Callout
        kind="problem"
        eyebrow="Start here"
        code={problem.jobCode}
        badge={{ label: problem.severity, tone: severityTone(problem.severity) }}
        title={problem.subtaskTitle}
        detail={problem.description}
        meta={[
          problem.departmentName,
          problem.assigneeName,
          `waiting ${formatElapsed(problem.ageHours * 60)}`,
        ]}
        action={{ href: `/problems?open=${problem.id}`, label: 'Review and decide' }}
      />
    );
  }

  if (late) {
    return (
      <Callout
        kind="late"
        eyebrow="Furthest behind"
        code={late.jobCode}
        badge={{ label: `${formatElapsed(late.overdueHours * 60)} late`, tone: 'late' }}
        title={late.title}
        detail={null}
        meta={[
          late.departmentName,
          late.assigneeName,
          late.escalationCount === 0
            ? 'not chased yet'
            : `chased ${late.escalationCount} ${late.escalationCount === 1 ? 'time' : 'times'}`,
        ]}
        action={{ href: `/tasks/${late.id}`, label: 'Open the task' }}
      />
    );
  }

  return (
    <div className="border-ok-edge bg-ok-soft text-ok flex items-center gap-3 rounded-lg border px-4 py-3.5">
      <CheckCircle2 className="size-[18px] shrink-0" strokeWidth={1.75} />
      <p className="text-sm font-medium">
        Nothing is waiting on you — no open problem and no deadline past due.
      </p>
    </div>
  );
}

function Callout({
  kind,
  eyebrow,
  code,
  badge,
  title,
  detail,
  meta,
  action,
}: {
  kind: 'problem' | 'late';
  eyebrow: string;
  code: string;
  badge: { label: string; tone: ReturnType<typeof severityTone> };
  title: string;
  detail: string | null;
  meta: string[];
  action: { href: string; label: string };
}) {
  const Icon = kind === 'problem' ? TriangleAlert : Clock;

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      {/* A 3px rule in the status colour, instead of tinting the whole block. */}
      <div className="flex">
        <span aria-hidden className="bg-late w-[3px] shrink-0" />
        <div className="min-w-0 flex-1 px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-late inline-flex items-center gap-1.5">
              <Icon className="size-4" strokeWidth={2} />
              <span className="eyebrow text-late">{eyebrow}</span>
            </span>
            <span className="bg-border h-3 w-px" aria-hidden />
            <span className="font-mono text-sm font-medium">{code}</span>
            <Badge variant={badge.tone === 'neutral' ? 'neutral' : badge.tone}>{badge.label}</Badge>
          </div>

          <div className="mt-2.5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="font-display text-base font-semibold">{title}</p>
              {detail ? (
                <p className="text-foreground/80 mt-1 line-clamp-2 text-sm">{detail}</p>
              ) : null}
              <p className="text-muted-foreground mt-1.5 text-sm">{meta.join(' · ')}</p>
            </div>

            <Link
              href={action.href}
              data-touch-target
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors"
            >
              {action.label}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
