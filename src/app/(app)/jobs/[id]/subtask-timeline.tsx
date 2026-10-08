'use client';

import { Ban, Lock, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { tone, type Tone } from '@/lib/ui/tone';
import type { SubtaskDto } from '@/lib/api/subtasks-client';
import { cn } from '@/lib/utils';
import { completionLabel, deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

/**
 * Band colours — SDD section 7.3.
 *
 * Grey pending, blue in progress, amber problem, green complete, red overdue.
 * Overdue is applied on top of the status colour rather than replacing it,
 * because a subtask is overdue *and* something else (improvement I-08), and the
 * MD needs both facts — which is why an overdue row carries two chips rather
 * than one chip reading "Overdue". A task can be in progress and late at the
 * same time, and collapsing that into one word loses who is still working.
 */
const STATUS_STYLES: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  BLOCKED: { label: 'Blocked', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  PROBLEM: { label: 'Problem', tone: 'late' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'risk' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
  ON_HOLD: { label: 'On hold', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

function commitmentLine(subtask: SubtaskDto): {
  primary: string;
  secondary: string;
  late: boolean;
} {
  if (subtask.deadline) {
    const deadline = new Date(subtask.deadline);
    const when = formatIST(deadline, 'dd MMM, hh:mm a');

    /*
     * Once the work is finished the question changes from "how long is left"
     * to "was it made". Measuring a completed step against now instead of
     * against its own completion reported a step finished on the day as
     * "13 days late", which is both wrong and exactly the kind of thing an
     * accountability system cannot afford to get wrong.
     */
    if (subtask.completedAt) {
      const label = completionLabel(deadline, new Date(subtask.completedAt));
      return { primary: when, secondary: label.text, late: label.overdue };
    }

    const relative = deadlineLabel(deadline).text;
    const who = subtask.deadlineOrigin === 'MD' ? 'Set by the MD' : 'Committed';
    return { primary: when, secondary: `${who} · ${relative}`, late: false };
  }

  if (subtask.status === 'BLOCKED' || !subtask.commitmentDueAt) {
    return { primary: 'Not their turn', secondary: 'No date yet', late: false };
  }

  const label = deadlineLabel(new Date(subtask.commitmentDueAt));
  return {
    primary: 'Awaiting commitment',
    secondary: label.overdue ? `Window closed · ${label.text}` : label.text,
    late: label.overdue,
  };
}

export function SubtaskStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <Badge variant={style.tone} className="whitespace-nowrap">
      {style.label}
    </Badge>
  );
}

/**
 * One row per subtask, in department shop-flow order.
 *
 * A route card rather than a stack of loose tiles: a hairline runs down the
 * left through a numbered marker per step, so the order the work travels in is
 * the first thing visible. The marker takes the row's tone, which means the
 * shape of a job — where it is, where it stopped — reads from across a desk.
 *
 * Clicking a row opens the drawer with history and the MD's actions.
 */
export function SubtaskTimeline({
  subtasks,
  onSelect,
  selectedId,
}: {
  subtasks: SubtaskDto[];
  onSelect: (subtask: SubtaskDto) => void;
  selectedId?: string | null;
}) {
  return (
    <ol className="relative">
      {/* The rail the markers sit on. Stops at the last marker, not the edge. */}
      <span
        aria-hidden
        className="bg-border absolute top-5 bottom-5 left-[11px] w-px"
        style={{ display: subtasks.length > 1 ? undefined : 'none' }}
      />

      {subtasks.map((subtask, index) => {
        const style = STATUS_STYLES[subtask.status] ?? STATUS_STYLES.PENDING;
        const commitment = commitmentLine(subtask);
        const isSelected = subtask.id === selectedId;
        const flagged = subtask.isOverdue || commitment.late;

        return (
          <li key={subtask.id} className="relative flex gap-3">
            {/* The step marker: position in the route, in the row's own tone. */}
            <span
              aria-hidden
              className={cn(
                'relative z-[1] mt-3.5 flex size-[23px] shrink-0 items-center justify-center rounded-full border-2 font-mono text-[10px] font-medium tabular-nums',
                subtask.isOverdue
                  ? 'border-late bg-late text-background'
                  : subtask.status === 'COMPLETED'
                    ? 'border-ok bg-ok text-background'
                    : cn('bg-card text-muted-foreground', borderFor(style.tone)),
              )}
            >
              {index + 1}
            </span>

            <button
              type="button"
              onClick={() => onSelect(subtask)}
              aria-label={`Open ${subtask.department.name} — ${subtask.title}`}
              className={cn(
                // Stacked on a phone, two columns from `sm`. Wrapping the two
                // halves onto one narrow row squeezed the title to one letter
                // and broke "waits for …" into a word per line.
                'border-border mb-2 flex min-w-0 flex-1 flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                'hover:bg-accent/50 focus-visible:outline-ring',
                isSelected ? 'border-primary bg-accent/40' : 'bg-card',
                subtask.status === 'CANCELLED' && 'opacity-60',
              )}
            >
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs font-medium">
                    {subtask.department.name}
                  </span>
                  {subtask.requiresApproval ? (
                    <Lock className="text-muted-foreground size-3" aria-label="Needs approval" />
                  ) : null}
                  {subtask.status === 'CANCELLED' ? (
                    <Ban className="text-muted-foreground size-3" aria-label="Cancelled" />
                  ) : null}
                </span>

                <span className="block font-medium sm:truncate">{subtask.title}</span>

                {/*
                  M6.4: an amber marker the moment a problem is open on this
                  band, with the member's first words — the MD should see that
                  something is stuck without opening anything.
                */}
                {subtask.openProblem ? (
                  <span className="text-risk flex items-start gap-1 text-xs">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span className="line-clamp-1">{subtask.openProblem.description}</span>
                  </span>
                ) : null}

                <span className="text-muted-foreground block text-xs">
                  {subtask.assignee.name}
                  {subtask.dependsOn ? (
                    <span className="hidden sm:inline"> · waits for {subtask.dependsOn.title}</span>
                  ) : null}
                </span>
              </span>

              <span className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <span className="sm:text-right">
                  <span className="code block text-sm">{commitment.primary}</span>
                  <span
                    className={cn(
                      'block text-xs',
                      flagged ? 'text-late font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {commitment.secondary}
                  </span>
                </span>

                <span className="flex shrink-0 flex-col items-end gap-1">
                  <SubtaskStatusBadge status={subtask.status} />
                  {/*
                    Overdue is a condition, not a replacement state: the status
                    chip still says what the department is doing, and this one
                    says it is late while doing it.
                  */}
                  {subtask.isOverdue ? (
                    <Badge variant="late" className="whitespace-nowrap">
                      Overdue
                    </Badge>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The marker's ring, for the states that are neither done nor late. */
function borderFor(name: Tone): string {
  return name === 'neutral' ? 'border-border' : tone(name).bar.replace('bg-', 'border-');
}
