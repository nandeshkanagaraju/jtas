'use client';

import { Ban, CircleAlert, Lock, TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { tone, type Tone } from '@/lib/ui/tone';
import type { SubtaskDto } from '@/lib/api/subtasks-client';
import { cn } from '@/lib/utils';
import { deadlineLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

/**
 * Band colours — SDD section 7.3.
 *
 * Grey pending, blue in progress, amber problem, green complete, red overdue.
 * Overdue is applied on top of the status colour rather than replacing it,
 * because a subtask is overdue *and* something else (improvement I-08), and the
 * MD needs both facts.
 */
/**
 * The band down a row's leading edge and the badge at its far end are the same
 * tone, resolved through lib/ui/tone so a completed subtask here is the green a
 * completed job is on the jobs list.
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

export function SubtaskStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <Badge variant={style.tone} className="whitespace-nowrap">
      {style.label}
    </Badge>
  );
}

/**
 * One band per subtask, in department shop-flow order.
 *
 * Clicking a band opens the drawer with history and the MD's actions.
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
  if (subtasks.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No subtasks yet. Add them from the job wizard.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {subtasks.map((subtask) => {
        const style = STATUS_STYLES[subtask.status] ?? STATUS_STYLES.PENDING;
        const label = deadlineLabel(new Date(subtask.deadline));
        const isSelected = subtask.id === selectedId;

        return (
          <li key={subtask.id}>
            <button
              type="button"
              onClick={() => onSelect(subtask)}
              aria-label={`Open ${subtask.title}`}
              className={cn(
                'bg-card flex w-full items-stretch gap-3 rounded-lg border text-left transition-colors',
                'hover:bg-accent/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                isSelected && 'border-primary bg-accent/40',
                subtask.status === 'CANCELLED' && 'opacity-60',
              )}
            >
              {/* The coloured band: the one thing readable across a workshop. */}
              <span
                aria-hidden
                className={cn(
                  'w-1.5 shrink-0 rounded-l-lg',
                  subtask.isOverdue ? 'bg-late' : tone(style.tone).bar,
                )}
              />

              <span className="flex flex-1 flex-wrap items-center justify-between gap-2 px-1 py-3 pr-3">
                <span className="min-w-0 space-y-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">{subtask.department.name}</span>
                    {subtask.requiresApproval ? (
                      <Lock className="text-muted-foreground size-3" aria-label="Needs approval" />
                    ) : null}
                  </span>

                  <span className="block truncate font-medium">{subtask.title}</span>

                  {/*
                    M6.4: an amber marker the moment a problem is open on this
                    band, with the member's first words — the MD should see that
                    something is stuck without opening anything.
                  */}
                  {subtask.openProblem ? (
                    <span className="text-risk flex items-start gap-1 text-xs">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                      <span className="line-clamp-1">{subtask.openProblem.description}</span>
                    </span>
                  ) : null}

                  <span className="text-muted-foreground block text-xs">
                    {subtask.assignee.name}
                    {subtask.dependsOn ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · waits for {subtask.dependsOn.title}
                      </span>
                    ) : null}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-right">
                    <span className="tabular block text-sm">
                      {formatIST(new Date(subtask.deadline), 'dd MMM, hh:mm a')}
                    </span>
                    <span
                      className={cn(
                        'block text-xs',
                        subtask.isOverdue
                          ? 'text-state-overdue font-medium'
                          : 'text-muted-foreground',
                      )}
                    >
                      {label.text}
                    </span>
                  </span>

                  {subtask.isOverdue ? (
                    <CircleAlert className="text-late size-4" aria-label="Overdue" />
                  ) : null}
                  {subtask.status === 'CANCELLED' ? (
                    <Ban className="text-muted-foreground size-4" />
                  ) : null}

                  <SubtaskStatusBadge status={subtask.status} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
