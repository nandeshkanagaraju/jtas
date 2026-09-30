'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Countdown } from '@/components/shared/countdown';
import { Button } from '@/components/ui/button';
import type { MyTaskDto } from '@/lib/api/my-tasks-client';
import type { BucketName } from '@/lib/domain/task-buckets';
import { cn } from '@/lib/utils';
import { formatIST } from '@/lib/utils/time';

import { ProblemForm, type Severity } from './problem-form';

const ACTION =
  'h-auto min-h-12 rounded-sm px-3 text-base font-semibold whitespace-normal motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]';

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
        'border-b border-[#313743] py-4',
        overdue && 'border-l-[3px] border-l-[#fb7185] pl-3',
      )}
    >
      <div className="xl:flex xl:items-start xl:gap-8">
        <div className="min-w-0 xl:flex-1">
          <div className="flex items-center justify-between gap-4 xl:justify-start">
            <Link
              href={`/tasks/${task.id}`}
              className="inline-flex min-h-11 items-center text-xl font-semibold tracking-tight text-[#f3f5f8] tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f3f5f8]"
            >
              {task.jobCode}
              <span className="sr-only">, details</span>
            </Link>
            <p className={cn('shrink-0 text-base font-semibold', stamp.className)}>{stamp.label}</p>
          </div>

          {task.partNumber ? (
            <p className="mt-1 text-base font-semibold text-[#f3f5f8] tabular-nums">
              {task.partNumber}
            </p>
          ) : null}

          <p className="mt-2 text-base text-[#f3f5f8]">{task.title}</p>

          <p className="mt-2 text-base font-semibold text-[#f3f5f8]">
            <Countdown
              deadline={task.deadline}
              className="text-base font-semibold !text-[#f3f5f8]"
            />
          </p>
          <p className="text-sm text-[#f3f5f8] tabular-nums">
            {formatIST(new Date(task.deadline))}
          </p>

          {blocked && task.dependency ? (
            <p className="mt-3 text-base text-[#f3f5f8]">
              Waiting on {task.dependency.departmentName} — {task.dependency.title}, due{' '}
              {formatIST(new Date(task.dependency.deadline), 'd MMM')}.
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
                  className={cn(
                    ACTION,
                    'w-full rounded-lg border border-[#313743] bg-[#262b36] text-[#f3f5f8] shadow-none hover:bg-[#262b36]',
                  )}
                  disabled={busy}
                  onClick={() => onAction('START')}
                >
                  Start work
                </Button>
              ) : null}

              <div
                className={cn('grid gap-2', task.requiresApproval ? 'grid-cols-1' : 'grid-cols-2')}
              >
                <Button
                  className={cn(
                    ACTION,
                    'rounded-lg bg-[#d6f25a] text-[#14180a] shadow-none hover:bg-[#d6f25a]',
                  )}
                  disabled={busy}
                  onClick={() => onAction('COMPLETE')}
                >
                  {task.requiresApproval ? 'Send for approval' : 'Mark completed'}
                </Button>
                <Button
                  variant="outline"
                  className={cn(
                    ACTION,
                    'rounded-lg border border-[#313743] bg-[#262b36] text-[#f3f5f8] shadow-none hover:bg-[#262b36]',
                  )}
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
): { label: string; className: string } {
  if (flags.done) return { label: 'Done', className: 'text-[#d6f25a]' };
  if (flags.blocked) return { label: 'Blocked', className: 'text-[#f3f5f8]' };
  if (flags.reported) return { label: 'Problem reported', className: 'text-[#f3f5f8]' };
  if (flags.waiting) return { label: 'With the MD', className: 'text-[#f3f5f8]' };
  if (flags.overdue) return { label: 'Overdue', className: 'text-[#fb7185]' };
  if (section === 'dueToday') return { label: 'Due today', className: 'text-[#fbbf24]' };
  if (task.status === 'IN_PROGRESS') return { label: 'In progress', className: 'text-[#d6f25a]' };
  return { label: 'Not started', className: 'text-[#f3f5f8]' };
}
