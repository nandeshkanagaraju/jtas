'use client';

import { Ban, CircleAlert, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
const STATUS_STYLES: Record<string, { label: string; band: string; badge: string }> = {
  PENDING: { label: 'Pending', band: 'bg-muted', badge: 'bg-muted text-muted-foreground' },
  BLOCKED: {
    label: 'Blocked',
    band: 'bg-muted',
    badge: 'bg-muted text-muted-foreground border border-border',
  },
  IN_PROGRESS: {
    label: 'In progress',
    band: 'bg-state-progress',
    badge: 'bg-state-progress text-white',
  },
  PROBLEM: { label: 'Problem', band: 'bg-state-problem', badge: 'bg-state-problem text-white' },
  AWAITING_APPROVAL: {
    label: 'Awaiting approval',
    band: 'bg-state-problem',
    badge: 'bg-state-problem text-white',
  },
  COMPLETED: {
    label: 'Completed',
    band: 'bg-state-complete',
    badge: 'bg-state-complete text-white',
  },
  ON_HOLD: { label: 'On hold', band: 'bg-muted', badge: 'bg-muted text-foreground' },
  CANCELLED: {
    label: 'Cancelled',
    band: 'bg-transparent',
    badge: 'bg-transparent text-muted-foreground border border-border',
  },
};

export function SubtaskStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return <Badge className={cn('whitespace-nowrap', style.badge)}>{style.label}</Badge>;
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
                'flex w-full items-stretch gap-3 rounded-lg border text-left transition-colors',
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
                  subtask.isOverdue ? 'bg-state-overdue' : style.band,
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
                    <CircleAlert className="text-state-overdue size-4" aria-label="Overdue" />
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
