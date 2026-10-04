'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Countdown } from '@/components/shared/countdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MyTaskDto } from '@/lib/api/my-tasks-client';
import type { BucketName } from '@/lib/domain/task-buckets';
import type { Tone } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

import { ProblemForm, type Severity } from './problem-form';

/* Shop-floor sizing: a gloved thumb, not a mouse. */
const ACTION =
  'h-auto min-h-12 rounded-md px-3 text-base font-semibold whitespace-normal motion-reduce:transition-none';

/**
 * One job on the traveller.
 *
 * The code and the part number are how the floor identifies the work, so they
 * lead. The operation title follows. Mark completed and Report problem are the
 * same size: reporting a stoppage is ordinary, not a confession.
 */
export function TaskCard({
  task,
  section,
  busy,
  onAction,
}: {
  task: MyTaskDto;
  section: BucketName;
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
   * here would be a button that always fails.
   */
  const reported = task.status === 'PROBLEM';
  const actionable = !blocked && !done && !waiting && !reported;
  const overdue = task.hoursRemaining < 0 && !done;
  const stamp = stampFor(task, section, { blocked, done, waiting, reported, overdue });

  return (
    <article
      className={cn(
        // Pulled out to the panel's edge so the overdue rule is flush with it
        // rather than floating inside the padding.
        'border-border -mx-4 border-b px-4 py-4 last:border-b-0',
        overdue && 'border-l-late border-l-[3px] pl-[calc(1rem-3px)]',
      )}
    >
      <div className="xl:flex xl:items-start xl:gap-8">
        <div className="min-w-0 xl:flex-1">
          <div className="flex items-center justify-between gap-4 xl:justify-start">
            <Link
              href={`/tasks/${task.id}`}
              className="text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center text-xl font-semibold tracking-tight tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {task.jobCode}
              <span className="sr-only">, details</span>
            </Link>
            <Badge variant={stamp.tone} className="shrink-0 px-2 py-1 text-sm">
              {stamp.label}
            </Badge>
          </div>

          {task.partNumber ? (
            <p className="text-foreground mt-1 text-base font-semibold tabular-nums">
              {task.partNumber}
            </p>
          ) : null}

          <p className="text-foreground mt-2 text-base">{task.title}</p>

          <p className="text-foreground mt-2 text-base font-semibold">
            {task.deadline ? (
              <Countdown
                deadline={task.deadline}
                className="!text-foreground text-base font-semibold"
              />
            ) : task.commitmentDueAt ? (
              <>
                Awaiting commitment ·{' '}
                <Countdown
                  deadline={task.commitmentDueAt}
                  className="!text-foreground text-base font-semibold"
                />
              </>
            ) : (
              'Not your turn yet'
            )}
          </p>
          <p className="text-foreground text-sm tabular-nums">
            {task.deadline
              ? formatIST(new Date(task.deadline))
              : task.commitmentDueAt
                ? `Commit by ${formatIST(new Date(task.commitmentDueAt))}`
                : 'No date yet'}
          </p>

          {blocked && task.dependency ? (
            <p className="text-foreground mt-3 text-base">
              Waiting on {task.dependency.departmentName} — {task.dependency.title}
              {task.dependency.deadline
                ? `, due ${formatIST(new Date(task.dependency.deadline), 'd MMM')}`
                : ''}
              .
            </p>
          ) : null}
        </div>

        <div className="mt-4 xl:mt-0 xl:w-80 xl:shrink-0">
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
            <div className="space-y-2">
              {task.status === 'PENDING' ? (
                <Button
                  variant="outline"
                  className={cn(ACTION, 'w-full')}
                  disabled={busy}
                  onClick={() => onAction('START')}
                >
                  Start work
                </Button>
              ) : null}

              <div
                className={cn('grid gap-2', task.requiresApproval ? 'grid-cols-1' : 'grid-cols-2')}
              >
                <Button className={ACTION} disabled={busy} onClick={() => onAction('COMPLETE')}>
                  {task.requiresApproval ? 'Send for approval' : 'Mark completed'}
                </Button>
                <Button
                  variant="outline"
                  className={ACTION}
                  disabled={busy}
                  onClick={() => setReporting(true)}
                >
                  Report problem
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function stampFor(
  task: MyTaskDto,
  section: BucketName,
  flags: { blocked: boolean; done: boolean; waiting: boolean; reported: boolean; overdue: boolean },
): { label: string; tone: Tone } {
  if (flags.done) return { label: 'Done', tone: 'ok' };
  if (flags.blocked) return { label: 'Blocked', tone: 'neutral' };
  if (flags.reported) return { label: 'Problem reported', tone: 'risk' };
  if (flags.waiting) return { label: 'With the MD', tone: 'info' };
  if (flags.overdue) return { label: 'Overdue', tone: 'late' };
  if (section === 'dueToday') return { label: 'Due today', tone: 'risk' };
  if (task.status === 'IN_PROGRESS') return { label: 'In progress', tone: 'info' };
  return { label: 'Not started', tone: 'neutral' };
}
