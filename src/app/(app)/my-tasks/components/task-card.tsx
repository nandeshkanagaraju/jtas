'use client';

import { T } from '@/lib/i18n/provider';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';

import { Countdown } from '@/components/shared/countdown';
import { PhoneDisclosure, usePhoneApp } from '@/components/shared/phone-app';
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
  emphasis = false,
  busy,
  onAction,
}: {
  task: MyTaskDto;
  section: BucketName;
  /** The only overdue task: it should be the thing the thumb hits. */
  emphasis?: boolean;
  busy: boolean;
  onAction: (
    action: 'START' | 'COMPLETE' | 'PROBLEM',
    payload?: { note: string; severity: Severity },
  ) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const phone = usePhoneApp();

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
        'task-work-card border-border -mx-4 border-b px-5 py-6 last:border-b-0',
        overdue && 'border-l-late border-l-[3px] pl-[calc(1rem-3px)]',
      )}
    >
      <div className="space-y-4">
        {phone ? (
          <div className="min-w-0 space-y-2">
            <Link
              href={`/tasks/${task.id}`}
              className="task-open-area block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="code inline-flex min-h-11 items-center text-sm font-semibold">
                  {task.jobCode}
                  <span className="sr-only">
                    <T>{', details'}</T>
                  </span>
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    overdue ? 'text-late' : 'text-muted-foreground',
                  )}
                >
                  <T>{stamp.label}</T>
                  {overdue ? <T>{' · Overdue'}</T> : ''}
                </span>
              </div>
              <p className="text-base leading-snug font-semibold">{task.title}</p>
              <p className={cn('text-sm', overdue ? 'text-late' : 'text-muted-foreground')}>
                {task.deadline ? (
                  `Due ${formatIST(new Date(task.deadline), 'd MMM, h:mm a')}`
                ) : task.commitmentDueAt ? (
                  `Commit by ${formatIST(new Date(task.commitmentDueAt), 'd MMM, h:mm a')}`
                ) : (
                  <T>{'Waiting for your turn'}</T>
                )}
              </p>
              {blocked && task.dependency ? (
                <p className="text-sm">
                  <T>{'Waiting on '}</T>
                  {task.dependency.departmentName}
                </p>
              ) : null}
            </Link>
            <PhoneDisclosure title="Task details">
              <p className="text-sm">
                {task.department.name}
                {task.partNumber ? ` · ${task.partNumber}` : ''}
              </p>
              {task.deadline ? <Countdown deadline={task.deadline} /> : null}
              {task.dependency ? (
                <p className="mt-2 text-sm">
                  {task.dependency.title}
                  {task.dependency.deadline
                    ? ` · ${formatIST(new Date(task.dependency.deadline))}`
                    : ''}
                </p>
              ) : null}
            </PhoneDisclosure>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <Link
                href={`/tasks/${task.id}`}
                className={cn(
                  'text-foreground focus-visible:outline-ring inline-flex min-h-11 items-center font-mono font-medium tracking-tight whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2',
                  emphasis ? 'text-[1.75rem] sm:text-3xl' : 'text-xl',
                )}
              >
                {task.jobCode}
                <span className="sr-only">
                  <T>{', details'}</T>
                </span>
              </Link>
              <p className="text-sm font-medium sm:pt-2 sm:text-right">
                <span
                  className={
                    stamp.tone === 'late'
                      ? 'text-late'
                      : stamp.tone === 'risk'
                        ? 'text-risk'
                        : stamp.tone === 'ok'
                          ? 'text-ok'
                          : stamp.tone === 'info'
                            ? 'text-info'
                            : 'text-foreground'
                  }
                >
                  <T>{stamp.label}</T>
                </span>
                {overdue ? (
                  <span className="text-late">
                    {' '}
                    <T>{' · Overdue'}</T>
                  </span>
                ) : null}
              </p>
            </div>

            {task.partNumber ? (
              <p className="text-foreground mt-1 font-mono text-base font-medium tabular-nums">
                {task.partNumber}
              </p>
            ) : null}

            <p
              className={cn('text-foreground mt-2', emphasis ? 'text-lg font-medium' : 'text-base')}
            >
              {task.title}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">{task.department.name}</p>

            <p className="text-foreground mt-2 text-base font-semibold">
              {task.deadline ? (
                <Countdown
                  deadline={task.deadline}
                  className="!text-foreground text-base font-semibold"
                />
              ) : task.commitmentDueAt ? (
                <>
                  <T>{'Awaiting commitment ·'}</T>{' '}
                  <Countdown
                    deadline={task.commitmentDueAt}
                    className="!text-foreground text-base font-semibold"
                  />
                </>
              ) : (
                <T>{'Not your turn yet'}</T>
              )}
            </p>
            <p className="text-foreground text-sm tabular-nums">
              {task.deadline ? (
                formatIST(new Date(task.deadline))
              ) : task.commitmentDueAt ? (
                `Commit by ${formatIST(new Date(task.commitmentDueAt))}`
              ) : (
                <T>{'No date yet'}</T>
              )}
            </p>

            {blocked && task.dependency ? (
              <p className="text-foreground mt-3 text-base">
                <T>{'Waiting on '}</T>
                {task.dependency.departmentName} — {task.dependency.title}
                {task.dependency.deadline
                  ? `, due ${formatIST(new Date(task.dependency.deadline), 'd MMM')}`
                  : ''}
                .
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-4 w-full">
          {phone ? (
            <Button asChild variant="outline" className={cn(ACTION, 'mb-3 w-full justify-between')}>
              <Link href={`/tasks/${task.id}`}>
                <T>
                  {!task.deadline && task.commitmentDueAt && !blocked && !done
                    ? 'Set deadline'
                    : 'Open task'}
                </T>
                <ArrowRight className="size-4 shrink-0" aria-hidden />
              </Link>
            </Button>
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
          ) : actionable && (!phone || task.deadline || !task.commitmentDueAt) ? (
            <div className="space-y-2">
              {task.status === 'PENDING' ? (
                <Button
                  variant={phone ? 'default' : 'outline'}
                  className={cn(ACTION, 'w-full')}
                  disabled={busy}
                  onClick={() => onAction('START')}
                >
                  <T>{'Start work '}</T>
                </Button>
              ) : null}

              <div
                className={cn('grid gap-2', task.requiresApproval ? 'grid-cols-1' : 'grid-cols-2')}
              >
                <Button
                  variant={phone && task.status === 'PENDING' ? 'outline' : 'default'}
                  className={ACTION}
                  disabled={busy}
                  onClick={() => onAction('COMPLETE')}
                >
                  {task.requiresApproval ? <T>{'Send for approval'}</T> : <T>{'Mark completed'}</T>}
                </Button>
                <Button
                  variant="outline"
                  className={ACTION}
                  disabled={busy}
                  onClick={() => setReporting(true)}
                >
                  <T>{'Report problem '}</T>
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
  if (section === 'dueToday' && task.status === 'PENDING')
    return { label: 'Due today', tone: 'risk' };
  if (task.status === 'IN_PROGRESS') return { label: 'In progress', tone: 'info' };
  if (flags.overdue) return { label: 'Not started', tone: 'late' };
  return { label: 'Not started', tone: 'neutral' };
}
