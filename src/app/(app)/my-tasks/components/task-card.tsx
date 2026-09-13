'use client';

import { Check, ChevronRight, CircleAlert, Lock, Play, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Countdown } from '@/components/shared/countdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MyTaskDto } from '@/lib/api/my-tasks-client';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

import { ProblemForm, type Severity } from './problem-form';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Not started',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  PROBLEM: 'Problem reported',
  AWAITING_APPROVAL: 'Waiting for the MD',
  COMPLETED: 'Done',
};

/**
 * One task, with the actions that finish it in a single tap.
 *
 * Everything a member needs to decide is above the buttons: which job, which
 * part, when it is due, and — when blocked — what it is waiting for. The whole
 * point of FR-30 is that the next thing to do is obvious without opening
 * anything.
 */
export function TaskCard({
  task,
  busy,
  onAction,
}: {
  task: MyTaskDto;
  busy: boolean;
  onAction: (
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  const [reporting, setReporting] = useState(false);

  const blocked = task.status === 'BLOCKED';
  const done = task.status === 'COMPLETED';
  const waiting = task.status === 'AWAITING_APPROVAL';
  /*
   * Once a problem is on record the subtask is the MD's to move: the state
   * machine allows only RESOLVE_PROBLEM out of PROBLEM, so offering Complete
   * here would be a button that always fails. Improvement I-05 in reverse —
   * the pressure has moved, and the screen should say so.
   */
  const reported = task.status === 'PROBLEM';
  const actionable = !blocked && !done && !waiting && !reported;

  return (
    <article
      className={cn(
        'bg-card space-y-3 rounded-lg border p-4',
        task.hoursRemaining < 0 && !done && 'border-state-overdue/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
            <span className="tabular">{task.jobCode}</span>
            {task.partNumber ? <span>· {task.partNumber}</span> : null}
            <span>· {task.department.name}</span>
          </div>

          <h3 className="leading-snug font-medium">{task.title}</h3>

          <div className="flex flex-wrap items-center gap-x-2 text-xs">
            <span className="tabular text-muted-foreground">
              {formatIST(new Date(task.deadline))}
            </span>
            <Countdown deadline={task.deadline} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {task.hasOpenProblem ? (
            <Badge className="bg-state-problem gap-1 text-white">
              <TriangleAlert className="size-3" />
              Problem
            </Badge>
          ) : (
            <Badge variant="outline" className="whitespace-nowrap">
              {STATUS_LABELS[task.status] ?? task.status}
            </Badge>
          )}
          {task.requiresApproval && !done ? (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Lock className="size-3" />
              MD approves
            </span>
          ) : null}
        </div>
      </div>

      {blocked && task.dependency ? (
        <p className="bg-muted/60 text-muted-foreground flex items-start gap-2 rounded-md px-3 py-2 text-xs">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Waiting on <span className="font-medium">{task.dependency.departmentName}</span> —{' '}
            {task.dependency.title}, due {formatIST(new Date(task.dependency.deadline))}.
          </span>
        </p>
      ) : null}

      {reporting ? (
        <ProblemForm
          busy={busy}
          autoFocus
          onCancel={() => setReporting(false)}
          onSubmit={(payload) => {
            setReporting(false);
            onAction('PROBLEM', payload);
          }}
        />
      ) : actionable ? (
        <div className="flex flex-wrap gap-2">
          {task.status === 'PENDING' ? (
            <Button
              variant="outline"
              className="min-h-11 flex-1"
              disabled={busy}
              onClick={() => onAction('START')}
            >
              <Play className="size-4" />
              Start
            </Button>
          ) : null}

          <Button className="min-h-11 flex-1" disabled={busy} onClick={() => onAction('COMPLETE')}>
            <Check className="size-4" />
            {task.requiresApproval ? 'Send for approval' : 'Completed'}
          </Button>

          <Button
            variant="outline"
            className="min-h-11 flex-1"
            disabled={busy}
            onClick={() => setReporting(true)}
          >
            <TriangleAlert className="size-4" />
            Problem
          </Button>
        </div>
      ) : reported ? (
        <p className="text-muted-foreground text-xs">
          Reported. The MD has it — you will see this move once they decide.
        </p>
      ) : null}

      <Link
        href={`/tasks/${task.id}`}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        Open task
        <ChevronRight className="size-3" />
      </Link>
    </article>
  );
}
