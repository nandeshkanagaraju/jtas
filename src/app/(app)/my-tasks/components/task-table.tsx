'use client';

import { T } from '@/lib/i18n/provider';

import {
  CalendarDays,
  CalendarRange,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  GitPullRequest,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';

import { Countdown } from '@/components/shared/countdown';
import { Button } from '@/components/ui/button';
import type { MyTaskDto, MyTasksDto } from '@/lib/api/my-tasks-client';
import { BUCKET_ORDER, type BucketName } from '@/lib/domain/task-buckets';
import { textClass } from '@/lib/ui/tone';
import { cn } from '@/lib/utils';
import { completionLabel } from '@/lib/utils/relative-time';
import { formatIST } from '@/lib/utils/time';

import { ProblemForm, type Severity } from './problem-form';
import { stampFor } from './task-card';
import { noDeadlineLabel, worksWithoutDeadline } from '@/lib/domain/department-rules';

type ActionHandler = (
  task: MyTaskDto,
  action: 'START' | 'COMPLETE' | 'PROBLEM',
  payload?: { note: string; severity: Severity },
) => void;

const TILES: Array<{
  name: BucketName;
  label: string;
  icon: LucideIcon;
  tone?: 'late' | 'risk' | 'info' | 'ok';
}> = [
  { name: 'overdue', label: 'Overdue', icon: Clock3, tone: 'late' },
  { name: 'dueToday', label: 'Due today', icon: CalendarDays, tone: 'risk' },
  { name: 'dueThisWeek', label: 'This week', icon: CalendarRange },
  { name: 'blocked', label: 'Blocked', icon: GitPullRequest },
  { name: 'awaitingApproval', label: 'With the MD', icon: ClipboardCheck, tone: 'info' },
  { name: 'recentlyCompleted', label: 'Done', icon: CircleCheck, tone: 'ok' },
];

/**
 * Desktop "My work": the same six counts as the Overview strip, then every
 * task in one table, most urgent first. A tile filters the table; clicking it
 * again shows everything.
 */
export function DesktopTaskTable({
  data,
  departmentId,
  busyId,
  onAction,
}: {
  data: MyTasksDto;
  departmentId?: string;
  busyId: string | null;
  onAction: ActionHandler;
}) {
  const [filter, setFilter] = useState<BucketName | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);

  const rows = BUCKET_ORDER.filter((name) => !filter || name === filter).flatMap((name) =>
    data.buckets[name].map((task) => ({ task, section: name })),
  );
  const next = departmentId
    ? data.buckets.overdue
        .concat(data.buckets.dueToday, data.buckets.dueThisWeek, data.buckets.later)
        .find(
          (task) =>
            task.department.id === departmentId &&
            (task.status === 'PENDING' || task.status === 'IN_PROGRESS'),
        )
    : undefined;

  return (
    <>
      <div className="pulse-strip">
        {TILES.map((tile) => {
          const value = data.buckets[tile.name].length;
          const active = filter === tile.name;
          return (
            <button
              key={tile.name}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(active ? null : tile.name)}
              className={cn('pulse-cell text-left', active && 'bg-card')}
            >
              <span className="desktop-pulse-icon" data-tone={tile.tone} aria-hidden="true">
                <tile.icon className="size-4" />
              </span>
              <span
                className={cn(
                  'text-xs',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                <T>{tile.label}</T>
              </span>
              <span
                className={cn(
                  'metric mt-4 block',
                  tile.tone && value > 0 ? textClass(tile.tone) : 'text-foreground',
                )}
              >
                {value}
              </span>
            </button>
          );
        })}
      </div>

      {next ? (
        <section className="desktop-next-task decision-hero" aria-labelledby="next-department-task">
          <div className="min-w-0">
            <p id="next-department-task" className="text-sm text-[#c4cebd]">
              <T>{'Next assigned task'}</T>
            </p>
            <p className="section-title mt-2 break-words">{next.title}</p>
            <p className="mt-2 text-sm text-[#c4cebd]">
              {next.jobCode} · {next.jobTitle}
              {next.deadline ? ` · ${formatIST(new Date(next.deadline), 'd MMM, h:mm a')}` : null}
            </p>
          </div>
          <Button asChild className="shrink-0">
            <Link href={`/tasks/${next.id}`}>
              <T>{'Open task'}</T>
            </Link>
          </Button>
        </section>
      ) : null}

      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <div className="border-border flex items-center justify-between gap-4 border-b px-5 py-3">
          <h2 className="text-base font-medium">
            {filter ? (
              <T>{TILES.find((tile) => tile.name === filter)?.label ?? ''}</T>
            ) : (
              <T>{'All my tasks'}</T>
            )}
          </h2>
          <span className="text-muted-foreground font-mono text-sm tabular-nums">
            {rows.length}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-sm">
            <T>{'Nothing here right now.'}</T>
          </p>
        ) : (
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th className="w-[17%] px-5 py-2.5 font-medium">
                  <T>{'Job'}</T>
                </th>
                <th className="px-3 py-2.5 font-medium">
                  <T>{'Task'}</T>
                </th>
                <th className="w-[17%] px-3 py-2.5 font-medium">
                  <T>{'Due'}</T>
                </th>
                <th className="w-[15%] px-3 py-2.5 font-medium">
                  <T>{'Status'}</T>
                </th>
                <th className="w-[25%] px-5 py-2.5 text-right font-medium">
                  <span className="sr-only">
                    <T>{'Actions'}</T>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, section }) => (
                <Fragment key={task.id}>
                  <Row
                    task={task}
                    section={section}
                    busy={busyId === task.id}
                    onAction={onAction}
                    onReport={() => setReportingId(task.id)}
                  />
                  {reportingId === task.id ? (
                    <tr className="border-border border-t">
                      <td colSpan={5} className="bg-muted/30 px-5 py-4">
                        <ProblemForm
                          busy={busyId === task.id}
                          autoFocus
                          onCancel={() => setReportingId(null)}
                          onSubmit={(payload) => {
                            setReportingId(null);
                            onAction(task, 'PROBLEM', payload);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Row({
  task,
  section,
  busy,
  onAction,
  onReport,
}: {
  task: MyTaskDto;
  section: BucketName;
  busy: boolean;
  onAction: ActionHandler;
  onReport: () => void;
}) {
  const blocked = task.status === 'BLOCKED';
  const done = task.status === 'COMPLETED';
  const waiting = task.status === 'AWAITING_APPROVAL';
  const reported = task.status === 'PROBLEM';
  const actionable = !blocked && !done && !waiting && !reported;
  const overdue = task.hoursRemaining < 0 && !done;
  const stamp = stampFor(task, section, { blocked, done, waiting, reported, overdue });

  return (
    <tr
      className={cn(
        'border-border hover:bg-muted/30 border-t align-top transition-colors',
        overdue && 'shadow-[inset_3px_0_0_var(--late)]',
      )}
    >
      <td className="px-5 py-4">
        <Link
          href={`/tasks/${task.id}`}
          className="font-mono font-medium tabular-nums hover:underline"
        >
          {task.jobCode}
        </Link>
        {task.partNumber ? (
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">{task.partNumber}</p>
        ) : null}
      </td>
      <td className="px-3 py-4">
        <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
          {task.title}
        </Link>
        <p className="text-muted-foreground mt-0.5 text-xs">{task.department.name}</p>
      </td>
      <td className="px-3 py-4">
        {task.deadline ? (
          <>
            <p className={cn('tabular-nums', overdue && 'text-late')}>
              {formatIST(new Date(task.deadline), 'd MMM, h:mm a')}
            </p>
            {done && task.completedAt ? (
              // Finished work is measured against its deadline, not against
              // today: a task done on time must not read "5 days late".
              <FinishedLabel deadline={task.deadline} completedAt={task.completedAt} />
            ) : (
              <Countdown deadline={task.deadline} className="text-xs" />
            )}
          </>
        ) : task.commitmentDueAt ? (
          <p className="text-muted-foreground text-xs">
            <T>{'Commit by '}</T>
            {formatIST(new Date(task.commitmentDueAt), 'd MMM, h:mm a')}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            <T>
              {worksWithoutDeadline(task.department.code)
                ? noDeadlineLabel(task.department.code)
                : 'No date yet'}
            </T>
          </p>
        )}
      </td>
      <td className="px-3 py-4">
        <p className={cn('font-medium', textClass(stamp.tone))}>
          <T>{stamp.label}</T>
          {overdue ? <T>{' · Overdue'}</T> : ''}
        </p>
        {blocked && task.dependency ? (
          <p className="text-muted-foreground mt-0.5 text-xs">
            <T>{'Waiting on '}</T>
            {task.dependency.departmentName}
          </p>
        ) : null}
      </td>
      <td className="px-5 py-4">
        {actionable ? (
          <div className="flex flex-wrap justify-end gap-2">
            {task.status === 'PENDING' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onAction(task, 'START')}
              >
                <T>{'Start work '}</T>
              </Button>
            ) : null}
            <Button size="sm" disabled={busy} onClick={() => onAction(task, 'COMPLETE')}>
              {task.requiresApproval ? <T>{'Send for approval'}</T> : <T>{'Mark completed'}</T>}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onReport}>
              <T>{'Report problem '}</T>
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button asChild size="sm" variant="ghost">
              <Link href={`/tasks/${task.id}`}>
                <T>{'Open task'}</T>
              </Link>
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function FinishedLabel({ deadline, completedAt }: { deadline: string; completedAt: string }) {
  const label = completionLabel(new Date(deadline), new Date(completedAt));
  return (
    <p className={cn('text-xs', label.overdue ? 'text-late font-medium' : 'text-ok')}>
      <T>{label.text.charAt(0).toUpperCase() + label.text.slice(1)}</T>
    </p>
  );
}
